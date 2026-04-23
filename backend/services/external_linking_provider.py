import secrets
from dataclasses import dataclass

from fastapi import HTTPException, status


ExternalProviderName = str


@dataclass(frozen=True)
class ExternalLinkingResult:
    provider: ExternalProviderName
    provider_customer_id: str | None
    provider_account_id: str | None
    verification_status: str = "verified"


class ExternalLinkingProvider:
    async def link_external_account(
        self,
        *,
        user_id: str,
        bank_name: str,
        routing_number: str,
        account_number: str,
    ) -> ExternalLinkingResult:
        raise NotImplementedError


class LocalExternalLinkingProvider(ExternalLinkingProvider):
    async def link_external_account(
        self,
        *,
        user_id: str,
        bank_name: str,
        routing_number: str,
        account_number: str,
    ) -> ExternalLinkingResult:
        return ExternalLinkingResult(
            provider="local",
            provider_customer_id=None,
            provider_account_id=None,
            verification_status="verified",
        )


class StripeSandboxExternalLinkingProvider(ExternalLinkingProvider):
    async def link_external_account(
        self,
        *,
        user_id: str,
        bank_name: str,
        routing_number: str,
        account_number: str,
    ) -> ExternalLinkingResult:
        # Deterministic per-link mock shape for sandbox-only provider IDs.
        provider_customer_id = f"cus_test_{user_id.replace('-', '')[:24]}"
        provider_account_id = f"ba_test_{secrets.token_hex(10)}"
        return ExternalLinkingResult(
            provider="stripe_sandbox",
            provider_customer_id=provider_customer_id,
            provider_account_id=provider_account_id,
            verification_status="verified",
        )


def get_external_linking_provider(provider_name: str | None) -> ExternalLinkingProvider:
    normalized = (provider_name or "stripe_sandbox").strip().lower()
    if normalized == "stripe_sandbox":
        return StripeSandboxExternalLinkingProvider()
    if normalized == "local":
        return LocalExternalLinkingProvider()
    raise HTTPException(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        detail=f"Unsupported external account provider '{provider_name}'.",
    )
