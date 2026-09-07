import { test, expect } from "@playwright/test";
test("mobile registration → deadline → start → pause → resume → personal submission confirmation", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByLabel("パスワード").fill("fictional-browser-password");
  await page.getByRole("button", { name: "ログイン", exact: true }).click();
  await page.getByRole("button", { name: "登録", exact: true }).click();
  await page.getByLabel("タイトルだけでもOK").fill("架空の演習レポート");
  await page
    .getByLabel("案内文", { exact: true })
    .fill("2027年9月18日までに提出してください。");
  await page.getByRole("button", { name: "受信箱に保存" }).click();
  await expect(
    page.getByRole("heading", { name: "架空の演習レポート", exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("提出日（年も確認）")).toHaveValue("2027-09-18");
  await page
    .getByLabel("根拠を確認し、提出期限の情報を明示的に変更する")
    .check();
  await page.getByRole("button", { name: "期限の確認・変更を保存" }).click();
  await expect(
    page.getByText("期限の変更前後と確認日時を記録しました。"),
  ).toBeVisible();
  await page.getByRole("button", { name: "今の一手", exact: true }).click();
  await expect(page.getByTestId("main-action")).toHaveCount(1);
  await expect(
    page.getByRole("heading", { name: "今の一手", exact: true }),
  ).toBeInViewport();
  await expect(
    page.getByTestId("main-action").getByText("次の具体的な一手があるため"),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({ path: "test-results/mobile-home.png" });
  await page
    .getByRole("button", { name: "始める", exact: false })
    .first()
    .click();
  await expect(page.getByText("開始を記録", { exact: true })).toBeVisible();
  await expect(
    page.getByText("提出は本人の申告", { exact: false }),
  ).toHaveCount(0);
  await page.getByLabel("再開メモ（任意）").fill("次は見出しを三つ書く");
  await page.getByRole("button", { name: "この地点で中断する" }).click();
  await expect(page.getByText("再開できます", { exact: true })).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "一覧・期限", exact: true }).click();
  await page
    .getByRole("button")
    .filter({ hasText: "架空の演習レポート" })
    .first()
    .click();
  await expect(
    page
      .getByTestId("main-action")
      .getByText("次は見出しを三つ書く", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "再開する", exact: false })
    .first()
    .click();
  await page.getByRole("button", { name: "今回の一手が終わった" }).click();
  await expect(
    page.getByText("提出は本人の申告", { exact: false }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "作業全体が終わった" }).click();
  await page
    .getByLabel("提出完了画面などで、提出済みであることを自分で確認した")
    .check();
  await page.getByRole("button", { name: "本人による提出確認を記録" }).click();
  await expect(
    page.getByText("提出は本人の申告", { exact: false }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "test-results/mobile-complete.png",
    fullPage: true,
  });
});
test("failed network save preserves entered text and never announces success", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByLabel("パスワード").fill("fictional-browser-password");
  await page.getByRole("button", { name: "ログイン", exact: true }).click();
  await page.getByRole("button", { name: "登録", exact: true }).click();
  await page.getByLabel("タイトルだけでもOK").fill("架空の未保存課題");
  await page.route("**/api/tasks", (route) =>
    route.request().method() === "POST" ? route.abort() : route.continue(),
  );
  await page.getByRole("button", { name: "受信箱に保存" }).click();
  await expect(page.getByRole("alert")).toContainText("保存されていません");
  await expect(page.getByLabel("タイトルだけでもOK")).toHaveValue(
    "架空の未保存課題",
  );
});
