import Create from '@/app/ui/create';
import Link from 'next/link';
import { getSignUpUrl, withAuth } from '@workos-inc/authkit-nextjs';

export default async function Page() {
  // Retrieves the user from the session or returns `null` if no user is signed in
  const { user } = await withAuth();

  // Get the URL to redirect the user to AuthKit to sign up
  const signUpUrl = await getSignUpUrl();

  if (!user) {
    return (
      <>
        <a href="/login">Sign in</a>
        <Link href={signUpUrl}>Sign up</Link>
      </>
    );
  }

  return (
    <div className="grid grid-rows-[20px_1fr_20px] items-center justify-items-center min-h-screen p-8 pb-20 gap-16 sm:p-20 font-(family-name:--font-geist-sans)">
      <main className="flex flex-col gap-[32px] row-start-2 items-center sm:items-start">
        <Create />
      </main>
    </div>
  );
}
