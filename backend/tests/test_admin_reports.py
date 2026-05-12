import pytest

from routers import admin


@pytest.mark.asyncio
async def test_account_report_excludes_closed_accounts(monkeypatch: pytest.MonkeyPatch) -> None:
    async def fake_select_rows(table: str, **kwargs):
        if table == "accounts":
            assert kwargs.get("filters") == {"status": "neq.closed"}
            return [
                {
                    "id": "acct-open",
                    "user_id": "user-1",
                    "status": "open",
                    "account_type": "checking",
                    "account_last4": "1234",
                    "current_balance_cents": 10000,
                    "available_balance_cents": 9000,
                    "created_at": "2026-01-01T00:00:00Z",
                }
            ]
        if table == "profiles":
            return [
                {
                    "id": "user-1",
                    "first_name": "Taylor",
                    "last_name": "Kim",
                    "email": "taylor@example.com",
                    "city": "San Jose",
                    "state": "CA",
                    "zip_code": "95112",
                }
            ]
        raise AssertionError(f"Unexpected table lookup: {table}")

    monkeypatch.setattr(admin.supabase_client, "select_rows", fake_select_rows)

    report = await admin.account_report(
        search=None,
        min_balance=None,
        max_balance=None,
        zip_code=None,
        city=None,
        state=None,
        account_type=None,
        status_filter=None,
        limit=1000,
        admin=None,
    )

    assert len(report.rows) == 1
    assert report.rows[0].accountId == "acct-open"
    assert report.summary.totalAccounts == 1
    assert report.summary.openAccounts == 1
    assert report.summary.restrictedAccounts == 0


@pytest.mark.asyncio
async def test_account_report_status_filter_only_returns_restricted_accounts(monkeypatch: pytest.MonkeyPatch) -> None:
    async def fake_select_rows(table: str, **kwargs):
        if table == "accounts":
            return [
                {
                    "id": "acct-open",
                    "user_id": "user-1",
                    "status": "open",
                    "account_type": "checking",
                    "account_last4": "1234",
                    "current_balance_cents": 10000,
                    "available_balance_cents": 9000,
                    "created_at": "2026-01-01T00:00:00Z",
                },
                {
                    "id": "acct-restricted",
                    "user_id": "user-2",
                    "status": "restricted",
                    "account_type": "savings",
                    "account_last4": "5678",
                    "current_balance_cents": 25000,
                    "available_balance_cents": 25000,
                    "created_at": "2026-01-02T00:00:00Z",
                },
            ]
        if table == "profiles":
            return [
                {
                    "id": "user-1",
                    "first_name": "Open",
                    "last_name": "User",
                    "email": "open@example.com",
                    "city": "San Jose",
                    "state": "CA",
                    "zip_code": "95112",
                },
                {
                    "id": "user-2",
                    "first_name": "Restricted",
                    "last_name": "User",
                    "email": "restricted@example.com",
                    "city": "Oakland",
                    "state": "CA",
                    "zip_code": "94607",
                },
            ]
        raise AssertionError(f"Unexpected table lookup: {table}")

    monkeypatch.setattr(admin.supabase_client, "select_rows", fake_select_rows)

    report = await admin.account_report(
        search=None,
        min_balance=None,
        max_balance=None,
        zip_code=None,
        city=None,
        state=None,
        account_type=None,
        status_filter="restricted",
        limit=1000,
        admin=None,
    )

    assert [row.accountId for row in report.rows] == ["acct-restricted"]
    assert report.summary.totalAccounts == 1
    assert report.summary.openAccounts == 0
    assert report.summary.restrictedAccounts == 1
