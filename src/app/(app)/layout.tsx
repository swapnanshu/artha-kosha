import Link from "next/link";
import { redirect } from "next/navigation";
import { getOwnerSession } from "@/lib/auth/verify-owner";
import { signOutAction } from "@/app/actions/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const nav = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/ledger", label: "Ledger" },
  { href: "/accounts", label: "Accounts" },
  { href: "/sources", label: "Sources" },
];

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await getOwnerSession();
  if (!session) redirect("/sign-in");

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-6xl flex-col px-4 sm:px-6">
      <header className="flex flex-wrap items-center gap-x-6 gap-y-3 border-b py-4">
        <Link href="/dashboard" className="text-base font-semibold tracking-tight">
          Artha<span className="text-primary">-</span>Kosha
        </Link>
        <nav className="flex items-center gap-1 text-sm">
          {nav.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="rounded-md px-3 py-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-3 text-sm">
          <span className="hidden text-muted-foreground sm:inline">{session.email}</span>
          <form action={signOutAction}>
            <button
              type="submit"
              className="rounded-md border px-3 py-1.5 text-sm transition-colors hover:bg-muted"
            >
              Sign out
            </button>
          </form>
        </div>
      </header>
      <main className="flex-1 py-6">{children}</main>
      <footer className="border-t py-4 text-xs text-muted-foreground">
        Private ledger · Asia/Kolkata · all amounts in INR
      </footer>
    </div>
  );
}
