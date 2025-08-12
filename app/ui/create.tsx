'use client';

import Form from 'next/form';
import { useState } from 'react';
import { AlertCircleIcon, CheckCircle2Icon } from 'lucide-react';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';

import { handleCreate } from '@/app/actions';

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
    <Card className="w-full max-w-sm">
      <CardHeader>
        <CardTitle>Tiny url</CardTitle>
      </CardHeader>

      <Form action={handleSubmit}>
        <div className="flex flex-col gap-6">
          <CardContent>
            <div className="grid gap-2">
              <Label htmlFor="url" className="block text-sm/6 font-medium text-white">
                Enter URL:
              </Label>
              <Input type="url" id="redirect" name="redirect" required />
            </div>
          </CardContent>
          <CardFooter className="flex-col gap-2">
            <Button variant="default" type="submit">
              Generate
            </Button>
          </CardFooter>
        </div>
      </Form>
      {uuid && (
        <Alert>
          <CheckCircle2Icon />
          <AlertTitle>Success! Your new tiny url</AlertTitle>
          <AlertDescription>
            <a href={`${url && url.origin}/t/${uuid}`} target="_blank" rel="noopener noreferrer">
              {url && url.origin}/t/{uuid}
            </a>
          </AlertDescription>
        </Alert>
      )}
      {error && (
        <Alert variant="destructive">
          <AlertCircleIcon />
          <AlertTitle>Sorry but we could not create the tiny url.</AlertTitle>
        </Alert>
      )}
    </Card>
  );
}
