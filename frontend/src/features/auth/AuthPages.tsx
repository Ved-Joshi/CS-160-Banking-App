import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { z } from 'zod';
import { Button, Card, Field, InlineAlert, PageHeader } from '../../components/ui';
import { authService } from '../../lib/mockApi';
import { supabase } from '../../lib/supabaseClient';
import type { RegistrationInput } from '../../types/banking';
import { useAuth } from './useAuth';
import { SESSION_KEY, writeStorage } from '../../lib/storage';

const US_STATES = [
  ['AL', 'Alabama'],
  ['AK', 'Alaska'],
  ['AZ', 'Arizona'],
  ['AR', 'Arkansas'],
  ['CA', 'California'],
  ['CO', 'Colorado'],
  ['CT', 'Connecticut'],
  ['DE', 'Delaware'],
  ['FL', 'Florida'],
  ['GA', 'Georgia'],
  ['HI', 'Hawaii'],
  ['ID', 'Idaho'],
  ['IL', 'Illinois'],
  ['IN', 'Indiana'],
  ['IA', 'Iowa'],
  ['KS', 'Kansas'],
  ['KY', 'Kentucky'],
  ['LA', 'Louisiana'],
  ['ME', 'Maine'],
  ['MD', 'Maryland'],
  ['MA', 'Massachusetts'],
  ['MI', 'Michigan'],
  ['MN', 'Minnesota'],
  ['MS', 'Mississippi'],
  ['MO', 'Missouri'],
  ['MT', 'Montana'],
  ['NE', 'Nebraska'],
  ['NV', 'Nevada'],
  ['NH', 'New Hampshire'],
  ['NJ', 'New Jersey'],
  ['NM', 'New Mexico'],
  ['NY', 'New York'],
  ['NC', 'North Carolina'],
  ['ND', 'North Dakota'],
  ['OH', 'Ohio'],
  ['OK', 'Oklahoma'],
  ['OR', 'Oregon'],
  ['PA', 'Pennsylvania'],
  ['RI', 'Rhode Island'],
  ['SC', 'South Carolina'],
  ['SD', 'South Dakota'],
  ['TN', 'Tennessee'],
  ['TX', 'Texas'],
  ['UT', 'Utah'],
  ['VT', 'Vermont'],
  ['VA', 'Virginia'],
  ['WA', 'Washington'],
  ['WV', 'West Virginia'],
  ['WI', 'Wisconsin'],
  ['WY', 'Wyoming'],
] as const;

function AuthLayout({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <div className="auth-layout">
      <section className="auth-hero">
        <Link className="auth-brand-link" to="/">
          SJ State Bank
        </Link>
        <div className="auth-hero__body">
          <h1>{title}</h1>
          <p>{subtitle}</p>
          <div className="auth-hero__panel">
            <strong>Trusted digital banking for your daily finances.</strong>
            <div className="auth-feature-list">
              <div className="auth-feature-item">See balances and recent activity at a glance</div>
              <div className="auth-feature-item">Move money, pay bills, and deposit checks online</div>
              <div className="auth-feature-item">Track pending and completed activity in one place</div>
            </div>
          </div>
        </div>
        <div className="auth-hero__stats" aria-hidden="true">
          <div className="auth-stat">
            <span>Balances</span>
            <strong>Always in view</strong>
          </div>
          <div className="auth-stat">
            <span>Payments</span>
            <strong>Simple to manage</strong>
          </div>
          <div className="auth-stat">
            <span>Security</span>
            <strong>Built into every step</strong>
          </div>
        </div>
      </section>
      <section className="auth-card-wrap">{children}</section>
    </div>
  );
}

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});

export function WelcomePage() {
  return (
    <AuthLayout title="Bank with confidence." subtitle="Secure online banking designed to keep your everyday finances within reach.">
      <Card className="auth-card auth-card--center auth-card--welcome">
        <div className="welcome-content">
          <PageHeader title="Online Banking" eyebrow="Secure access" subtitle="Sign in to manage accounts, transfers, bill pay, deposits, and nearby ATMs." />
          <div className="button-row">
            <Link className="button button--primary" to="/login">
              Sign in
            </Link>
          </div>
          <div className="auth-secondary-action">
            <Link className="text-link" to="/register">
              Enroll now
            </Link>
          </div>
        </div>
      </Card>
    </AuthLayout>
  );
}

export function LoginPage() {
  const navigate = useNavigate();
  const { user, signIn, mfaPending } = useAuth();
  const [serverError, setServerError] = useState('');
  const form = useForm<z.infer<typeof loginSchema>>({
    resolver: zodResolver(loginSchema),
    defaultValues: {
      email: '',
      password: '',
    },
  });

  if (user && !mfaPending) {
    return <Navigate to="/app/dashboard" replace />;
  }

  return (
    <AuthLayout title="Secure sign in" subtitle="Sign in to view balances, review activity, and manage your accounts online.">
      <Card className="auth-card">
        <form
          className="stack-lg"
          onSubmit={form.handleSubmit(async (values) => {
            try {
              setServerError('');
              const result = await signIn(values.email, values.password);
              navigate(result === 'mfa' ? '/mfa' : '/app/dashboard');
            } catch (error) {
              setServerError(error instanceof Error ? error.message : 'Sign in failed.');
            }
          })}
        >
          <PageHeader title="Sign in" eyebrow="Online access" subtitle="Your accounts, statements, and payments in one place." />
          {serverError ? <InlineAlert title="Unable to sign in" tone="warning">{serverError}</InlineAlert> : null}
          <Field label="Email address" error={form.formState.errors.email?.message}>
            <input {...form.register('email')} type="email" />
          </Field>
          <Field label="Password" error={form.formState.errors.password?.message}>
            <input {...form.register('password')} type="password" />
          </Field>
          <div className="button-row">
            <Button type="submit">Continue</Button>
          </div>
          <div className="auth-secondary-action">
            <Link className="text-link" to="/reset-password">
              Forgot password?
            </Link>
          </div>
          <p className="muted auth-support-copy">
            Need online access?{' '}
            <Link className="text-link" to="/register">Enroll now</Link>
          </p>
        </form>
      </Card>
    </AuthLayout>
  );
}

const codeSchema = z.object({
  code: z.string().length(6),
});

export function MfaPage() {
  const navigate = useNavigate();
  const { completeMfa, signOut } = useAuth();
  const [serverError, setServerError] = useState('');
  const [infoMessage, setInfoMessage] = useState('');
  const form = useForm<z.infer<typeof codeSchema>>({
    resolver: zodResolver(codeSchema),
    defaultValues: { code: '' },
  });

  return (
    <AuthLayout title="Verify your device" subtitle="Enter the six-digit code sent to your phone to continue securely.">
      <Card className="auth-card">
        <form
          className="stack-lg"
          onSubmit={form.handleSubmit(async (values) => {
            try {
              setServerError('');
              setInfoMessage('');
              await completeMfa(values.code);
              navigate('/app/dashboard');
            } catch (error) {
              setServerError(error instanceof Error ? error.message : 'Verification failed.');
            }
          })}
        >
          <PageHeader title="Multi-factor authentication" eyebrow="Security check" subtitle="Enter the SMS code sent to your phone to finish signing in." />
          {serverError ? <InlineAlert title="Verification failed" tone="warning">{serverError}</InlineAlert> : null}
          {infoMessage ? <InlineAlert title="Code sent" tone="success">{infoMessage}</InlineAlert> : null}
          <Field label="Security code" error={form.formState.errors.code?.message}>
            <input {...form.register('code')} inputMode="numeric" />
          </Field>
          <div className="button-row">
            <Button type="submit">Verify and continue</Button>
          </div>
          <div className="auth-secondary-action">
            <button
              className="text-link"
              type="button"
              onClick={async () => {
                await signOut();
                navigate('/login');
              }}
            >
              Back to sign in
            </button>
            <button
              className="text-link"
              type="button"
              onClick={async () => {
                try {
                  setServerError('');
                  await authService.resendMfa();
                  setInfoMessage('A new SMS code was sent to your phone.');
                } catch (error) {
                  setServerError(error instanceof Error ? error.message : 'Unable to resend the code.');
                }
              }}
            >
              Resend code
            </button>
          </div>
        </form>
      </Card>
    </AuthLayout>
  );
}

const registerSchema = z.object({
  email: z.string().email(),
  mobilePhone: z.string().refine((value) => {
    const digits = value.replace(/\D/g, '');
    return digits.length === 10 || (digits.length === 11 && digits.startsWith('1'));
  }, 'Enter a valid mobile phone number.'),
  streetAddress: z.string().min(3, 'Street address is required.'),
  apartmentUnit: z.string().optional(),
  city: z.string().min(2, 'City is required.'),
  state: z.string().length(2, 'Use the 2-letter state code.'),
  zipCode: z.string().regex(/^\d{5}(?:-\d{4})?$/, 'Enter a valid ZIP code.'),
  dateOfBirth: z.string().refine((value) => {
    const parsed = Date.parse(value);
    return !Number.isNaN(parsed) && parsed < Date.now();
  }, 'Enter a valid date of birth.'),
  username: z.string().min(3).max(32).regex(/^[A-Za-z0-9._-]+$/, 'Use letters, numbers, periods, underscores, or hyphens.'),
  password: z.string().min(8),
  passwordConfirmation: z.string().min(8),
  taxId: z.string().refine((value) => value.replace(/\D/g, '').length === 9, 'Enter a valid 9-digit SSN or TIN.'),
}).refine((values) => values.password === values.passwordConfirmation, {
  message: 'Passwords must match.',
  path: ['passwordConfirmation'],
});

export function RegisterPage() {
  const navigate = useNavigate();
  const { register } = useAuth();
  const [serverError, setServerError] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const form = useForm<RegistrationInput>({
    resolver: zodResolver(registerSchema),
    defaultValues: {
      email: '',
      mobilePhone: '',
      streetAddress: '',
      apartmentUnit: '',
      city: '',
      state: '',
      zipCode: '',
      dateOfBirth: '',
      username: '',
      password: '',
      passwordConfirmation: '',
      taxId: '',
    },
  });

  return (
    <AuthLayout title="Open your online access" subtitle="Create your online banking profile to manage accounts and payments securely.">
      <Card className="auth-card auth-card--wide">
        <form
          className="stack-lg"
          onSubmit={form.handleSubmit(async (values) => {
            try {
              setServerError('');
              const result = await register(values);
              setSubmitted(true);
              navigate(result === 'mfa' ? '/mfa' : '/app/dashboard');
            } catch (error) {
              setSubmitted(false);
              setServerError(error instanceof Error ? error.message : 'Unable to create your account.');
            }
          })}
        >
          <PageHeader title="Enroll in online banking" eyebrow="New customer" subtitle="Create secure online access for your personal banking profile." />
          {serverError ? <InlineAlert title="Unable to create access" tone="warning">{serverError}</InlineAlert> : null}
          {submitted ? <InlineAlert title="Enrollment started" tone="success">We sent a verification code to your phone to finish enrollment.</InlineAlert> : null}
          <div className="grid-two">
            <Field label="Email address" error={form.formState.errors.email?.message}>
              <input {...form.register('email')} autoComplete="email" type="email" />
            </Field>
            <Field label="Mobile phone number" error={form.formState.errors.mobilePhone?.message}>
              <input {...form.register('mobilePhone')} autoComplete="tel" inputMode="tel" type="tel" />
            </Field>
          </div>
          <div className="stack-md">
            <p className="eyebrow">Residential address</p>
            <div className="grid-two">
              <Field label="Street address" error={form.formState.errors.streetAddress?.message}>
                <input {...form.register('streetAddress')} autoComplete="address-line1" />
              </Field>
              <Field label="Apartment/unit (optional)" error={form.formState.errors.apartmentUnit?.message}>
                <input {...form.register('apartmentUnit')} autoComplete="address-line2" />
              </Field>
              <Field label="City" error={form.formState.errors.city?.message}>
                <input {...form.register('city')} autoComplete="address-level2" />
              </Field>
              <Field label="State" error={form.formState.errors.state?.message}>
                <select {...form.register('state')} autoComplete="address-level1">
                  <option value="">Select a state</option>
                  {US_STATES.map(([code, name]) => (
                    <option key={code} value={code}>
                      {name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="ZIP code" error={form.formState.errors.zipCode?.message}>
                <input {...form.register('zipCode')} autoComplete="postal-code" inputMode="numeric" />
              </Field>
              <Field label="Date of Birth" error={form.formState.errors.dateOfBirth?.message}>
                <input {...form.register('dateOfBirth')} autoComplete="bday" type="date" />
              </Field>
            </div>
          </div>
          <div className="grid-two">
            <Field label="Username" error={form.formState.errors.username?.message}>
              <input {...form.register('username')} autoComplete="username" />
            </Field>
            <Field label="Social Security Number (SSN) or Tax Identification Number (TIN)" error={form.formState.errors.taxId?.message}>
              <input {...form.register('taxId')} autoComplete="off" inputMode="numeric" />
            </Field>
          </div>
          <div className="grid-two">
            <Field label="Password" error={form.formState.errors.password?.message}>
              <input {...form.register('password')} autoComplete="new-password" type="password" />
            </Field>
            <Field label="Password confirmation" error={form.formState.errors.passwordConfirmation?.message}>
              <input {...form.register('passwordConfirmation')} autoComplete="new-password" type="password" />
            </Field>
          </div>
          <div className="button-row">
            <Button type="submit">Create access</Button>
          </div>
          <div className="auth-secondary-action">
            <Link className="text-link" to="/login">
              Already enrolled? Sign in
            </Link>
          </div>
        </form>
      </Card>
    </AuthLayout>
  );
}

const resetSchema = z.object({
  email: z.string().email(),
});

const updatePasswordSchema = z.object({
  password: z.string().min(8),
  confirm: z.string().min(8),
}).refine((values) => values.password === values.confirm, {
  message: 'Passwords must match.',
  path: ['confirm'],
});

export function ResetPasswordPage() {
  const [submitted, setSubmitted] = useState('');
  const [canUpdate, setCanUpdate] = useState(false);
  const [serverError, setServerError] = useState('');

  const requestForm = useForm<z.infer<typeof resetSchema>>({
    resolver: zodResolver(resetSchema),
  });

  const updateForm = useForm<z.infer<typeof updatePasswordSchema>>({
    resolver: zodResolver(updatePasswordSchema),
  });

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setCanUpdate(Boolean(data.session));
    });

    const { data: listener } = supabase.auth.onAuthStateChange((event, ctx) => {
      if (event === 'PASSWORD_RECOVERY' || (event === 'SIGNED_IN' && ctx)) {
        setCanUpdate(true);
      }
    });

    return () => {
      listener?.subscription.unsubscribe();
    };
  }, []);

  return (
    <AuthLayout
      title={canUpdate ? 'Create a new password' : 'Reset your password'}
      subtitle={canUpdate ? 'Enter a new password to finish resetting your account access.' : 'Request a password reset link to restore access to your account.'}
    >
      <Card className="auth-card">
        {canUpdate ? (
          <form
            className="stack-lg"
            onSubmit={updateForm.handleSubmit(async (values) => {
              setServerError('');
              const { error } = await supabase.auth.updateUser({ password: values.password });
              if (error) {
                updateForm.setError('password', { message: error.message });
                return;
              }
              setSubmitted('updated');
              await supabase.auth.signOut();
              writeStorage(SESSION_KEY, null);
            })}
          >
            <PageHeader title="Set new password" eyebrow="Password reset" subtitle="Choose a new password for your account." />
            {submitted === 'updated' ? (
              <InlineAlert title="Password updated" tone="success">
                Your password has been changed. You can now sign in with the new password.
              </InlineAlert>
            ) : null}
            <Field label="New password" error={updateForm.formState.errors.password?.message}>
              <input {...updateForm.register('password')} type="password" autoComplete="new-password" />
            </Field>
            <Field label="Confirm password" error={updateForm.formState.errors.confirm?.message}>
              <input {...updateForm.register('confirm')} type="password" autoComplete="new-password" />
            </Field>
            <div className="button-row">
              <Button type="submit">Update password</Button>
            </div>
            <div className="auth-secondary-action">
              <Link
                className="text-link"
                to="/login"
                onClick={async (event) => {
                  event.preventDefault();
                  await supabase.auth.signOut();
                  writeStorage(SESSION_KEY, null);
                  window.location.replace('/login');
                }}
              >
                Back to sign in
              </Link>
            </div>
          </form>
        ) : (
          <form
            className="stack-lg"
            onSubmit={requestForm.handleSubmit(async (values) => {
              try {
                setServerError('');
                const result = await authService.requestReset(values.email);
                setSubmitted(result.email);
              } catch (error) {
                const message = error instanceof Error ? error.message : 'Unable to send reset email right now.';
                setServerError(message);
              }
            })}
          >
            <PageHeader title="Forgot password" eyebrow="Account recovery" subtitle="Enter your email address and we will send password reset instructions." />
            {serverError ? (
              <InlineAlert title="Unable to send email" tone="warning">
                {serverError}
              </InlineAlert>
            ) : null}
            {submitted ? (
              <InlineAlert title="Reset request sent" tone="success">
                A password reset link has been sent to {submitted}.
              </InlineAlert>
            ) : null}
            <Field label="Email address" error={requestForm.formState.errors.email?.message}>
              <input {...requestForm.register('email')} type="email" />
            </Field>
            <div className="button-row">
              <Button type="submit">Send link</Button>
            </div>
            <div className="auth-secondary-action">
              <Link className="text-link" to="/login">
                Back to sign in
              </Link>
            </div>
          </form>
        )}
      </Card>
    </AuthLayout>
  );
}
