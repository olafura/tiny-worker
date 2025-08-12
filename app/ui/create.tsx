'use client';

import Form from 'next/form';
import { useState } from 'react';
import { handleCreate } from '@/app/actions';
import { Label } from '@/app/components/ui/label';
import { Input } from '@/app/components/ui/input';
import { Button } from '@/app/components/ui/button';

export default function Create() {
  let url;
  if (typeof window !== 'undefined') {
    url = new URL(window.location.href);
  }
  const [uuid, setUuid] = useState('');
  const [error, setError] = useState(false);
  async function handleSubmit(formData: FormData) {
    const uuid = crypto.randomUUID();
    if (formData.has('redirect')) {
      const redirectValue = formData.get('redirect') as string;
      const hasCreated = await handleCreate(uuid, redirectValue);
      if (hasCreated) {
        setUuid(uuid);
      } else {
        setError(true);
      }
    }
  }
  return (
    <>
      <Form action={handleSubmit}>
        <Label htmlFor="url" className="block text-sm/6 font-medium text-white">
          Enter URL to shorten:
        </Label>
        <Input type="url" id="redirect" name="redirect" required />
        <Button type="submit">Shorten</Button>
      </Form>
      {uuid && (
        <div>
          New tiny url {url && url.origin}/t/{uuid}
        </div>
      )}
      {error && <div>Sorry but we could not create the tiny url.</div>}
    </>
  );
}
