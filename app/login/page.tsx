"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { api } from "@/lib/api-client";

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [checkingStatus, setCheckingStatus] = useState(true);
  const [isSetup, setIsSetup] = useState(false);
  const [googleEnabled, setGoogleEnabled] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    api.auth.status().then(({ data }) => {
      setIsSetup(!(data?.hasUser ?? true));
      setGoogleEnabled(data?.googleEnabled ?? false);
      setCheckingStatus(false);
    });
  }, []);

  useEffect(() => {
    if (searchParams.get("error") === "google") {
      setError("Googleログインに失敗しました。もう一度お試しください。");
    }
  }, [searchParams]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const { error } = isSetup
      ? await api.auth.setup(email, password)
      : await api.auth.login(email, password);
    setLoading(false);
    if (error) {
      // サーバーが日本語のエラーメッセージを返すのでそれを優先する
      setError(
        error.message ||
          "ログインに失敗しました。メールアドレスとパスワードを確認してください。"
      );
      return;
    }
    router.push("/");
    router.refresh();
  };

  if (checkingStatus) return null;

  return (
    <main className="flex min-h-dvh items-center justify-center p-4">
      <div className="w-full max-w-sm rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
        <h1 className="mb-1 text-xl font-bold">Travel Log</h1>
        <p className="mb-6 text-sm text-gray-500">観光地訪問記録アプリ</p>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium">
              メールアドレス
            </label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
              placeholder="you@example.com"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">パスワード</label>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
            />
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-lg bg-blue-600 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {loading
              ? "処理中…"
              : isSetup
                ? "アカウントを作成"
                : "ログイン"}
          </button>
        </form>

        {googleEnabled && (
          <>
            <div className="my-4 flex items-center gap-3">
              <div className="h-px flex-1 bg-gray-200" />
              <span className="text-xs text-gray-400">または</span>
              <div className="h-px flex-1 bg-gray-200" />
            </div>

            <a
              href="/api/auth/google"
              className="flex w-full items-center justify-center gap-2 rounded-lg border border-gray-300 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              <svg viewBox="0 0 48 48" className="h-4 w-4" aria-hidden="true">
                <path
                  fill="#FFC107"
                  d="M43.6 20.5H42V20.4H24v7.2h11.3c-1.6 4.5-5.9 7.6-11.3 7.6-6.9 0-12.6-5.6-12.6-12.6S17.1 9.9 24 9.9c3.2 0 6.1 1.2 8.3 3.2l5.1-5.1C34.5 4.9 29.5 2.8 24 2.8 12.4 2.8 2.8 12.4 2.8 24S12.4 45.2 24 45.2 45.2 35.6 45.2 24c0-1.2-.1-2.4-.4-3.5z"
                />
                <path
                  fill="#FF3D00"
                  d="M6.3 14.7l6 4.4C13.9 15.2 18.6 12.2 24 12.2c3.2 0 6.1 1.2 8.3 3.2l5.1-5.1C34.5 6.9 29.5 4.8 24 4.8c-7.4 0-13.8 4.2-16.9 10.4z"
                />
                <path
                  fill="#4CAF50"
                  d="M24 45.2c5.4 0 10.3-2.1 14-5.5l-5.6-4.6c-2 1.5-4.8 2.5-8.4 2.5-5.4 0-9.9-3.6-11.5-8.6l-6 4.6C9.9 40.9 16.4 45.2 24 45.2z"
                />
                <path
                  fill="#1976D2"
                  d="M43.6 20.5H42V20.4H24v7.2h11.3c-.8 2.2-2.2 4.1-4 5.5l5.6 4.6c-.4.4 6.4-4.7 6.4-13.7 0-1.2-.1-2.4-.4-3.5z"
                />
              </svg>
              Googleでログイン
            </a>
            <p className="mt-2 text-xs text-gray-400">
              Googleログインを設定したアカウントは、パスワードでのログインが無効になります。
            </p>
          </>
        )}

        <p className="mt-4 text-xs text-gray-400">
          {isSetup
            ? "初回起動のため、最初のアカウントを作成してください(フェーズ1はこの1人のみ利用可能)。"
            : "アカウントは初回起動時に作成したものを使用してください。"}
        </p>
      </div>
    </main>
  );
}
