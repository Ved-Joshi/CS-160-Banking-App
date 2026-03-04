import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { z } from 'zod';
import { Button, Card, Field, InlineAlert, PageHeader } from '../../components/ui';
import { authService } from '../../lib/mockApi';
import { useAuth } from './useAuth';

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
  const { user, signIn } = useAuth();
  const [serverError, setServerError] = useState('');
  const form = useForm<z.infer<typeof loginSchema>>({
    resolver: zodResolver(loginSchema),
    defaultValues: {
      email: 'alex.morgan@examplebank.com',
      password: 'Password123',
    },
  });

  if (user) {
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
              await signIn(values.email, values.password);
              navigate('/app/dashboard');
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
  const { completeMfa } = useAuth();
  const [serverError, setServerError] = useState('');
  const form = useForm<z.infer<typeof codeSchema>>({
    resolver: zodResolver(codeSchema),
    defaultValues: { code: '941205' },
  });

  return (
    <AuthLayout title="Verify your device" subtitle="Enter the six-digit code sent to your phone to continue securely.">
      <Card className="auth-card">
        <form
          className="stack-lg"
          onSubmit={form.handleSubmit(async (values) => {
            try {
              setServerError('');
              await completeMfa(values.code);
              navigate('/app/dashboard');
            } catch (error) {
              setServerError(error instanceof Error ? error.message : 'Verification failed.');
            }
          })}
        >
          <PageHeader title="Multi-factor authentication" eyebrow="Security check" subtitle="Complete verification to finish signing in to your account." />
          {serverError ? <InlineAlert title="Verification failed" tone="warning">{serverError}</InlineAlert> : null}
          <Field label="Security code" error={form.formState.errors.code?.message}>
            <input {...form.register('code')} inputMode="numeric" />
          </Field>
          <div className="button-row">
            <Button type="submit">Verify and continue</Button>
          </div>
          <div className="auth-secondary-action">
            <Link className="text-link" to="/login">
              Back to sign in
            </Link>
          </div>
        </form>
      </Card>
    </AuthLayout>
  );
}

const registerSchema = z.object({
  firstName: z.string().min(2),
  lastName: z.string().min(2),
  email: z.string().email(),
  password: z.string().min(8),
});

export function RegisterPage() {
  const navigate = useNavigate();
  const { register } = useAuth();
  const form = useForm<z.infer<typeof registerSchema>>({
    resolver: zodResolver(registerSchema),
  });

  return (
    <AuthLayout title="Open your online access" subtitle="Create your online banking profile to manage accounts and payments securely.">
      <Card className="auth-card">
        <form
          className="stack-lg"
          onSubmit={form.handleSubmit(async () => {
            await register();
            navigate('/app/dashboard');
          })}
        >
          <PageHeader title="Enroll in online banking" eyebrow="New customer" subtitle="Create secure online access for your personal banking profile." />
          <div className="grid-two">
            <Field label="First name" error={form.formState.errors.firstName?.message}>
              <input {...form.register('firstName')} />
            </Field>
            <Field label="Last name" error={form.formState.errors.lastName?.message}>
              <input {...form.register('lastName')} />
            </Field>
          </div>
          <Field label="Email address" error={form.formState.errors.email?.message}>
            <input {...form.register('email')} type="email" />
          </Field>
          <Field label="Password" error={form.formState.errors.password?.message}>
            <input {...form.register('password')} type="password" />
          </Field>
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

export function ResetPasswordPage() {
  const [submitted, setSubmitted] = useState('');
  const form = useForm<z.infer<typeof resetSchema>>({
    resolver: zodResolver(resetSchema),
  });

  return (
    <AuthLayout title="Reset your password" subtitle="Request a password reset link to restore access to your account.">
      <Card className="auth-card">
        <form
          className="stack-lg"
          onSubmit={form.handleSubmit(async (values) => {
            const result = await authService.requestReset(values.email);
            setSubmitted(result.email);
          })}
        >
          <PageHeader title="Forgot password" eyebrow="Account recovery" subtitle="Enter your email address and we will send password reset instructions." />
          {submitted ? (
            <InlineAlert title="Reset request sent" tone="success">
              A password reset link has been sent to {submitted}.
            </InlineAlert>
          ) : null}
          <Field label="Email address" error={form.formState.errors.email?.message}>
            <input {...form.register('email')} type="email" />
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
      </Card>
    </AuthLayout>
  );
}
