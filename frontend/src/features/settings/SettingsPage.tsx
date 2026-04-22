import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { Button, Card, Field, InlineAlert, PageHeader } from '../../components/ui';
import { profileService } from '../../lib/bankingApi';
import { formatDate } from '../../lib/format';
import type { UpdateCustomerProfileInput } from '../../types/banking';

const profileSchema = z.object({
  firstName: z.string().trim().min(1, 'First name is required.').max(80),
  middleName: z.string().trim().max(80).optional(),
  lastName: z.string().trim().min(1, 'Last name is required.').max(80),
  phone: z.string().min(10, 'Phone number is required.').max(20),
  streetAddress: z.string().trim().min(1, 'Street address is required.').max(160),
  apartmentUnit: z.string().trim().max(30).optional(),
  city: z.string().trim().min(1, 'City is required.').max(80),
  state: z.string().trim().length(2, 'Use 2-letter state code.'),
  zipCode: z.string().min(5, 'ZIP code is required.').max(10),
});

export function SettingsPage() {
  const queryClient = useQueryClient();
  const { data: profile } = useQuery({ queryKey: ['profile'], queryFn: profileService.get });
  const [saveSuccess, setSaveSuccess] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const form = useForm<UpdateCustomerProfileInput>({
    resolver: zodResolver(profileSchema),
    defaultValues: {
      firstName: '',
      middleName: '',
      lastName: '',
      phone: '',
      streetAddress: '',
      apartmentUnit: '',
      city: '',
      state: '',
      zipCode: '',
    },
  });

  useEffect(() => {
    if (!profile) return;
    form.reset({
      firstName: profile.firstName,
      middleName: profile.middleName ?? '',
      lastName: profile.lastName,
      phone: profile.phone === '—' ? '' : profile.phone,
      streetAddress: profile.streetAddress,
      apartmentUnit: profile.apartmentUnit ?? '',
      city: profile.city,
      state: profile.state,
      zipCode: profile.zipCode,
    });
  }, [form, profile]);

  const updateMutation = useMutation({
    mutationFn: profileService.update,
    onSuccess: async () => {
      setSaveSuccess('Profile updated.');
      setIsEditing(false);
      await queryClient.invalidateQueries({ queryKey: ['profile'] });
    },
  });

  return (
    <div className="stack-xl">
      <PageHeader title="Settings" eyebrow="Profile" subtitle="Update your contact and address details." />
      <div className="settings-profile-wrap">
        <Card>
          <h3>Profile</h3>
          {saveSuccess ? <InlineAlert title="Saved" tone="success">{saveSuccess}</InlineAlert> : null}
          {updateMutation.error ? (
            <InlineAlert title="Unable to save" tone="warning">
              {updateMutation.error instanceof Error ? updateMutation.error.message : 'Try again.'}
            </InlineAlert>
          ) : null}
          {isEditing ? (
            <form
              className="stack-lg"
              onSubmit={form.handleSubmit((values) => {
                setSaveSuccess(null);
                updateMutation.mutate({
                  ...values,
                  state: values.state.toUpperCase(),
                });
              })}
            >
              <div className="grid-two">
                <Field error={form.formState.errors.firstName?.message} label="First name">
                  <input {...form.register('firstName')} />
                </Field>
                <Field error={form.formState.errors.middleName?.message} label="Middle name">
                  <input {...form.register('middleName')} />
                </Field>
              </div>
              <div className="grid-two">
                <Field error={form.formState.errors.lastName?.message} label="Last name">
                  <input {...form.register('lastName')} />
                </Field>
                <Field error={form.formState.errors.phone?.message} label="Phone">
                  <input {...form.register('phone')} />
                </Field>
              </div>
              <Field error={form.formState.errors.streetAddress?.message} label="Street address">
                <input {...form.register('streetAddress')} />
              </Field>
              <div className="grid-two">
                <Field error={form.formState.errors.apartmentUnit?.message} label="Apt / Unit">
                  <input {...form.register('apartmentUnit')} />
                </Field>
                <Field error={form.formState.errors.city?.message} label="City">
                  <input {...form.register('city')} />
                </Field>
              </div>
              <div className="grid-two">
                <Field error={form.formState.errors.state?.message} label="State">
                  <input {...form.register('state')} maxLength={2} />
                </Field>
                <Field error={form.formState.errors.zipCode?.message} label="ZIP code">
                  <input {...form.register('zipCode')} />
                </Field>
              </div>
              <div className="grid-two">
                <Field label="Email">
                  <input disabled value={profile?.email ?? ''} />
                </Field>
                <Field label="Member since">
                  <input disabled value={profile ? formatDate(profile.memberSince) : ''} />
                </Field>
              </div>
              <div className="button-row">
                <Button disabled={updateMutation.isPending} type="submit">
                  {updateMutation.isPending ? 'Saving...' : 'Save changes'}
                </Button>
                <Button
                  onClick={() => {
                    setIsEditing(false);
                    if (profile) {
                      form.reset({
                        firstName: profile.firstName,
                        middleName: profile.middleName ?? '',
                        lastName: profile.lastName,
                        phone: profile.phone === '—' ? '' : profile.phone,
                        streetAddress: profile.streetAddress,
                        apartmentUnit: profile.apartmentUnit ?? '',
                        city: profile.city,
                        state: profile.state,
                        zipCode: profile.zipCode,
                      });
                    }
                  }}
                  type="button"
                  variant="secondary"
                >
                  Cancel
                </Button>
              </div>
            </form>
          ) : profile ? (
            <>
              <dl className="stat-list">
                <div>
                  <dt>Name</dt>
                  <dd>{profile.fullName}</dd>
                </div>
                <div>
                  <dt>Phone</dt>
                  <dd>{profile.phone}</dd>
                </div>
                <div>
                  <dt>Email</dt>
                  <dd>{profile.email}</dd>
                </div>
                <div>
                  <dt>Member since</dt>
                  <dd>{formatDate(profile.memberSince)}</dd>
                </div>
                <div>
                  <dt>Address</dt>
                  <dd>{profile.address}</dd>
                </div>
              </dl>
              <div className="button-row">
                <Button
                  onClick={() => {
                    setSaveSuccess(null);
                    setIsEditing(true);
                  }}
                  type="button"
                >
                  Edit profile
                </Button>
              </div>
            </>
          ) : null}
        </Card>
      </div>
    </div>
  );
}
