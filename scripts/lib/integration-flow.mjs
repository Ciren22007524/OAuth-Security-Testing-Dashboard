import { openBrowser } from "./browser.mjs";
const APP = "https://app.example.com",
  GOOGLE = "https://accounts.google.test";
export async function runFlow(
  { createOidcTestService, createArrayApp, fakeIdentities, ISSUER },
  persona,
  { fault, signal } = {},
) {
  const who = persona === "B" ? "stranger" : "me";
  const source = await createOidcTestService({
    ALLOWED_EMAILS: "me@gmail.com,stranger@gmail.com",
  });
  let browser;
  const assertions = [],
    evidence = [];
  const check = (name, condition) => {
    assertions.push({ name, passed: Boolean(condition) });
    if (!condition) throw new Error(name);
  };
  let fatal,
    requests = 0,
    backendExchanges = 0,
    backendUserInfo = 0;
  try {
    const owner = await source.memory.store.upsertUserByIdentity(
      { provider: "google", ...fakeIdentities.me },
      source.clock.now,
    );
    const registration = await source.gateway(
      new Request(ISSUER + "/oidc/reg", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          client_name: "Dashboard isolated integration",
          scope: "openid email profile",
          redirect_uris: [APP + "/auth/callback"],
          token_endpoint_auth_method: "client_secret_basic",
        }),
      }),
      source.env,
      owner.id,
    );
    const client = await registration.json();
    requests++;
    evidence.push({
      request: {
        method: "POST",
        path: "/oidc/reg",
        role: "auth-service",
        transport: "隔離來源 API",
      },
      response: { status: registration.status },
    });
    check(
      "隔離來源自動註冊後端 client，取得當次 secret",
      registration.status === 201 &&
        typeof client.client_id === "string" &&
        typeof client.client_secret === "string",
    );
    const records = new Map();
    const store = (key) => ({
      async put(value) {
        records.set(key, structuredClone(value));
      },
      async read() {
        const v = records.get(key);
        return v?.expires > Date.now() / 1000 ? structuredClone(v) : null;
      },
      async take() {
        const v = records.get(key);
        records.delete(key);
        return v?.expires > Date.now() / 1000 ? structuredClone(v) : null;
      },
      async remove() {
        if (fault === "old-session-still-valid" && key.startsWith("session:"))
          return;
        records.delete(key);
      },
    });
    const app = createArrayApp(async (input, init) => {
      const url = new URL(input);
      if (url.origin !== ISSUER) throw new Error("Unexpected backend origin");
      if (url.pathname === source.as.token_endpoint?.replace(ISSUER, ""))
        backendExchanges++;
      if (url.pathname === source.as.userinfo_endpoint?.replace(ISSUER, ""))
        backendUserInfo++;
      if (++requests > 40)
        throw new Error("Integration request budget exceeded");
      const response = await source.api(url, init);
      evidence.push({
        request: {
          method: init?.method || "GET",
          path: url.pathname,
          role: "auth-service",
          transport: "Array 後端",
        },
        response: { status: response.status },
      });
      return response;
    });
    const limiter = {
      async limit() {
        return { success: true };
      },
    };
    const env = {
      APP_ORIGIN: APP,
      SSO_ISSUER: ISSUER,
      SSO_CLIENT_ID: client.client_id,
      SSO_CLIENT_SECRET: client.client_secret,
      REQUEST_LIMITER: limiter,
      LOGIN_LIMITER: limiter,
      CALLBACK_LIMITER: limiter,
    };
    browser = await openBrowser();
    browser.on("Fetch.requestPaused", async (event) => {
      try {
        if (++requests > 40)
          throw new Error("Integration request budget exceeded");
        const url = new URL(event.request.url);
        let response;
        if (url.origin === GOOGLE) {
          response = new Response(null, {
            status: 303,
            headers: {
              Location:
                ISSUER +
                "/callback/google?" +
                new URLSearchParams({
                  state: url.searchParams.get("state") || "",
                  code: who,
                }),
            },
          });
        } else if (url.origin === APP || url.origin === ISSUER) {
          const headers = new Headers(event.request.headers);
          if (!headers.has("cookie")) {
            const cookies = await browser.call("Network.getCookies", {
              urls: [url.href],
            });
            if (cookies.cookies.length)
              headers.set(
                "cookie",
                cookies.cookies.map((c) => `${c.name}=${c.value}`).join("; "),
              );
          }
          let data = event.request.postData;
          if (
            event.request.hasPostData &&
            data === undefined &&
            event.networkId
          ) {
            data = (
              await browser.call("Network.getRequestPostData", {
                requestId: event.networkId,
              })
            ).postData;
          }
          const request = new Request(url, {
            method: event.request.method,
            headers,
            ...(!["GET", "HEAD"].includes(event.request.method)
              ? { body: data || "" }
              : {}),
          });
          response =
            url.origin === APP
              ? await app(request, env, store)
              : await source.api(url, {
                  method: request.method,
                  headers: request.headers,
                  ...(!["GET", "HEAD"].includes(request.method)
                    ? { body: await request.arrayBuffer() }
                    : {}),
                });
        } else {
          await browser.call("Fetch.failRequest", {
            requestId: event.requestId,
            errorReason: "BlockedByClient",
          });
          return;
        }
        const responseHeaders = [...response.headers]
          .filter(([key]) => key !== "set-cookie")
          .map(([name, value]) => ({ name, value }));
        for (const value of response.headers.getSetCookie())
          responseHeaders.push({ name: "set-cookie", value });
        const body = Buffer.from(await response.arrayBuffer()).toString(
          "base64",
        );
        evidence.push({
          request: {
            method: event.request.method,
            path: url.pathname.replace(
              /^(\/oidc\/(?:auth|interaction))\/[^/]+/,
              "$1/[REDACTED]",
            ),
            role:
              url.origin === APP
                ? "Array"
                : url.origin === ISSUER
                  ? "auth-service"
                  : "假 Google",
          },
          response: { status: response.status },
        });
        await browser.call("Fetch.fulfillRequest", {
          requestId: event.requestId,
          responseCode: response.status,
          responseHeaders,
          body,
        });
      } catch {
        fatal = "整合請求失敗";
        await browser
          .call("Fetch.failRequest", {
            requestId: event.requestId,
            errorReason: "Failed",
          })
          .catch(() => {});
      }
    });
    await browser.call("Fetch.enable", {
      patterns: [{ urlPattern: "*", requestStage: "Request" }],
    });
    const wait = async (expression) => {
      for (let i = 0; i < 200; i++) {
        signal?.throwIfAborted();
        if (fatal) throw new Error(fatal);
        if (await browser.evaluate(expression)) return;
        await new Promise((r) => setTimeout(r, 50));
      }
      throw new Error("Integration page timed out");
    };
    await browser.call("Page.navigate", { url: APP + "/" });
    await wait(
      "document.readyState==='complete' && document.querySelector('a[href=\"/auth/login\"]')!==null",
    );
    const readMe = async () => {
      await browser.call("Page.navigate", { url: APP + "/api/me" });
      await wait(
        "location.pathname==='/api/me' && document.readyState==='complete' && document.contentType.includes('json')",
      );
      return {
        status: evidence.findLast(
          (record) =>
            record.request.role === "Array" &&
            record.request.path === "/api/me",
        ).response.status,
        body: await browser.evaluate(
          "JSON.parse(document.querySelector('pre')?.textContent || document.body.textContent)",
        ),
      };
    };
    const anonymous = await readMe();
    check(
      "未登入的 /api/me 回 401 login_required",
      anonymous.status === 401 && anonymous.body.error === "login_required",
    );
    await browser.call("Page.navigate", { url: APP + "/" });
    await wait("document.querySelector('a[href=\"/auth/login\"]')!==null");
    await browser.evaluate(
      "document.querySelector('a[href=\"/auth/login\"]').click()",
    );
    await wait(
      "location.origin==='https://app.example.com' && document.querySelector('form[action=\"/auth/logout\"]')!==null",
    );
    const me = await readMe();
    check(
      `使用者 ${persona} 經真實 OIDC 換碼與 UserInfo 建立本站身分`,
      me.status === 200 &&
        typeof me.body.user?.sub === "string" &&
        me.body.user.email === fakeIdentities[who].email &&
        me.body.expiresAt > Date.now() / 1000,
    );
    check(
      "後端完成 token 與 UserInfo 請求",
      backendExchanges === 1 && backendUserInfo === 1,
    );
    check(
      "/api/me 沒有 token 欄位",
      !JSON.stringify(me.body).includes("access_token") &&
        !JSON.stringify(me.body).includes("id_token"),
    );
    const cookies = (await browser.call("Network.getCookies", { urls: [APP] }))
      .cookies;
    const session = cookies.find((c) => c.name === "__Host-array_sso_session");
    check(
      "Chrome 收到 Secure／HttpOnly／SameSite=Lax 本站 cookie",
      session?.secure && session.httpOnly && session.sameSite === "Lax",
    );
    check(
      "頁面 JavaScript 讀不到 session cookie",
      !(await browser.evaluate("document.cookie")).includes(
        "__Host-array_sso_session",
      ),
    );
    const oldSession = session.value;
    await browser.call("Page.navigate", { url: APP + "/" });
    await wait(
      "document.querySelector('form[action=\"/auth/logout\"]')!==null",
    );
    await browser.evaluate(
      "document.querySelector('form[action=\"/auth/logout\"]').requestSubmit()",
    );
    await wait(
      "location.origin==='https://app.example.com' && document.querySelector('a[href=\"/auth/login\"]')!==null",
    );
    const after = await readMe();
    check(
      "本站登出後 /api/me 回 401",
      after.status === 401 && after.body.error === "login_required",
    );
    const replay = await app(
      new Request(APP + "/api/me", {
        headers: { Cookie: `__Host-array_sso_session=${oldSession}` },
      }),
      env,
      store,
    );
    check(
      "手動重送舊 session 仍回 401（伺服器已撤銷）",
      replay.status === 401 && (await replay.json()).error === "login_required",
    );
    check(
      "本站登出沒有刪除 issuer SSO cookie",
      (await browser.call("Network.getCookies", { urls: [ISSUER] })).cookies
        .length > 0,
    );
    return { status: "PASS", assertions, evidence, requests };
  } catch {
    return {
      status: assertions.some((a) => !a.passed) ? "FAIL" : "ERROR",
      assertions,
      evidence,
      error:
        "整合流程未完成，請查看最後成立的斷言；未輸出 cookie、code、token 或個人資料。",
      requests,
    };
  } finally {
    if (browser) await browser.close();
    await source.close();
  }
}
