import { test, expect, type Cookie, type Page } from "@playwright/test";
let savedCookies: Cookie[] = [];
async function login(page: Page, guide = false) {
  if (!guide)
    await page.addInitScript(() =>
      localStorage.setItem("task-control:guide:v1", "done"),
    );
  if (savedCookies.length) await page.context().addCookies(savedCookies);
  await page.goto("/");
  if (!savedCookies.length) {
    await page.getByLabel("パスワード").fill("fictional-browser-password");
    await page.getByRole("button", { name: "ログイン", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "今日すること", exact: true }),
    ).toBeVisible();
    savedCookies = await page.context().cookies();
  }
  await expect(
    page.getByRole("heading", { name: "今日すること", exact: true }),
  ).toBeVisible();
}
async function add(page: Page, title: string, original = "") {
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "追加", exact: true })
    .click();
  await page
    .getByLabel("課題名や、やりたいこと", { exact: true })
    .fill(original ? `${title}。${original}` : title);
  await page.getByRole("button", { name: "課題を保存", exact: true }).click();
  await page.getByRole("button", { name: "詳細を見る", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: title, exact: true }),
  ).toBeVisible();
}
async function noOverflow(page: Page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
}
async function taskData(page: Page, title: string) {
  const r = await page.request.get("/api/tasks");
  return (await r.json()).find((t: any) => t.title === title);
}
test("mobile: add → simple deadline → start → pause → reload → resume → work done → submit", async ({
  page,
}) => {
  await login(page);
  await add(
    page,
    "架空の演習レポート",
    "2099年9月18日までに提出してください。",
  );
  await page.getByRole("button", { name: "締切を入力", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(
    dialog.getByRole("heading", { name: "締切はいつ？" }),
  ).toBeVisible();
  await expect(dialog.getByLabel("締切日", { exact: true })).toHaveValue(
    "2099-09-18",
  );
  await dialog.getByRole("button", { name: "締切を保存", exact: true }).click();
  await expect(
    page.getByText("締切を保存しました。", { exact: true }),
  ).toBeVisible();
  let t = await taskData(page, "架空の演習レポート");
  expect(t.deadline.confirmed).toBe(true);
  expect(t.deadline.time).toBeNull();
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "今日", exact: true })
    .click();
  await expect(page.getByTestId("main-action")).toHaveCount(1);
  await expect(
    page.getByRole("heading", { name: "今日すること" }),
  ).toBeInViewport();
  await expect(page.getByTestId("main-action")).not.toContainText("根拠");
  await noOverflow(page);
  await page.screenshot({
    path: "test-results/mobile-home.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "はじめる", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "自分のペースで進めましょう。" }),
  ).toBeVisible();
  expect((await taskData(page, "架空の演習レポート")).submittedAt).toBeNull();
  await page.getByRole("button", { name: "途中で休む", exact: true }).click();
  await dialog.getByLabel("次はどこから？").fill("次は見出しを三つ書く");
  await dialog
    .getByRole("button", { name: "続きのメモを保存して休む" })
    .click();
  await expect(
    page.getByText("続きのメモを保存しました。またここから始められます。"),
  ).toBeVisible();
  await page.reload();
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "課題", exact: true })
    .click();
  await page
    .getByRole("button", {
      name: /架空の演習レポート.*2099|架空の演習レポート.*9月/,
    })
    .click();
  await expect(
    page.getByText("次は見出しを三つ書く", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "続きからはじめる", exact: true })
    .click();
  await page
    .getByRole("button", { name: "作業が終わった", exact: true })
    .click();
  await dialog
    .getByRole("button", { name: "作業は終わった。提出へ進む" })
    .click();
  await expect(
    page.getByRole("heading", { name: "あとは、提出。" }),
  ).toBeVisible();
  expect((await taskData(page, "架空の演習レポート")).submittedAt).toBeNull();
  await page
    .getByRole("button", { name: "提出済みにする", exact: true })
    .click();
  await dialog.getByRole("button", { name: "提出済みにする" }).click();
  expect((await taskData(page, "架空の演習レポート")).submittedAt).toBeNull();
  await dialog.getByLabel("提出先で、送信できたことを確認しました").check();
  await dialog.getByRole("button", { name: "提出済みにする" }).click();
  await expect(
    page.getByRole("heading", { name: "おつかれさまでした。" }),
  ).toBeVisible();
  t = await taskData(page, "架空の演習レポート");
  expect(t.state).toBe("closed");
  expect(t.submittedAt).toBeTruthy();
  await noOverflow(page);
});
test("title only can start without entering a deadline; changes remain explicit", async ({
  page,
}) => {
  await login(page);
  await add(page, "架空のタイトルだけ");
  await expect(
    page.getByText("締切はまだ未入力", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "はじめる", exact: true }).click();
  let t = await taskData(page, "架空のタイトルだけ");
  expect(t.state).toBe("active");
  expect(t.deadline.kind).toBe("unknown");
  await page.getByText("ほかの操作", { exact: true }).click();
  await page.getByRole("button", { name: "ひと区切りだけ終わった" }).click();
  t = await taskData(page, "架空のタイトルだけ");
  expect(t.submittedAt).toBeNull();
  expect(t.state).toBe("ready");
});
test("failed registration keeps input and shows a useful error", async ({
  page,
}) => {
  await login(page);
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "追加", exact: true })
    .click();
  await page
    .getByLabel("課題名や、やりたいこと", { exact: true })
    .fill("架空の未保存");
  await page.route("**/api/intake", (route) =>
    route.request().method() === "POST" ? route.abort() : route.continue(),
  );
  await page.getByRole("button", { name: "課題を保存" }).click();
  await expect(page.getByRole("alert")).toContainText("保存できませんでした");
  await expect(
    page.getByLabel("課題名や、やりたいこと", { exact: true }),
  ).toHaveValue("架空の未保存");
});
test("tutorial is brief, skippable, persisted and can be reopened without creating tasks", async ({
  page,
}) => {
  await login(page, true);
  const dialog = page.getByRole("dialog");
  await expect(
    dialog.getByRole("heading", { name: "かんたん使い方" }),
  ).toBeVisible();
  const before = await (await page.request.get("/api/tasks")).json();
  await dialog.getByRole("button", { name: "今はスキップ" }).click();
  await expect(dialog).toHaveCount(0);
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "今日すること" }),
  ).toBeVisible();
  await expect(dialog).toHaveCount(0);
  await page.getByRole("button", { name: "使い方を見る", exact: true }).click();
  await dialog.getByRole("button", { name: "次へ" }).click();
  await expect(dialog.getByText("「はじめる」から、作業へ。")).toBeVisible();
  await dialog.getByRole("button", { name: "次へ" }).click();
  await expect(dialog.getByText("休むときは、続きをひとこと。")).toBeVisible();
  await page.screenshot({ path: "test-results/mobile-guide.png" });
  await dialog.getByRole("button", { name: "課題を追加する" }).click();
  await expect(
    page.getByRole("heading", { name: "課題を追加", exact: true }),
  ).toBeVisible();
  expect((await (await page.request.get("/api/tasks")).json()).length).toBe(
    before.length,
  );
});
test("dialog traps keyboard focus, closes on Escape and preserves failed deadline input", async ({
  page,
}) => {
  await login(page);
  await add(page, "架空の入力失敗");
  await page.getByRole("button", { name: "締切を入力" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("締切について", { exact: true }).selectOption("date");
  await dialog.getByLabel("締切日", { exact: true }).fill("2099-11-11");
  await page.keyboard.press("Tab");
  expect(await dialog.evaluate((d) => d.contains(document.activeElement))).toBe(
    true,
  );
  await page.route("**/api/tasks/*/deadline", (route) => route.abort());
  await dialog.getByRole("button", { name: "締切を保存" }).click();
  await expect(dialog.getByRole("alert")).toContainText("保存できませんでした");
  await expect(dialog.getByLabel("締切日", { exact: true })).toHaveValue(
    "2099-11-11",
  );
  expect((await taskData(page, "架空の入力失敗")).deadline.kind).toBe(
    "unknown",
  );
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("button", { name: "締切を入力" })).toBeFocused();
});
test("rescheduling changes the plan, never the deadline", async ({ page }) => {
  await login(page);
  await add(page, "架空のあとで", "2099年12月20日まで");
  const before = (await taskData(page, "架空のあとで")).deadline;
  await page.getByRole("button", { name: "始めにくい", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: /今は時間や元気がない/ })
    .click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("取り組む日時").fill("2099-12-15T10:00");
  await dialog.getByRole("button", { name: "この時間にする" }).click();
  await expect(
    page.getByText("取り組む予定を保存しました。締切は変わりません。"),
  ).toBeVisible();
  const after = await taskData(page, "架空のあとで");
  expect(after.deadline).toEqual(before);
  expect(after.planAt).toBeTruthy();
});
test("PC sidebar, dark mode and enlarged text keep important actions accessible", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await login(page);
  await add(page, "架空のデザイン課題");
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "課題", exact: true })
    .click();
  await page
    .getByRole("button", { name: "架空のデザイン課題を今日の課題にする" })
    .click();
  await expect(
    page
      .getByTestId("main-action")
      .getByRole("button", { name: "はじめる", exact: true }),
  ).toBeInViewport();
  await page.screenshot({
    path: "test-results/desktop-home.png",
    fullPage: true,
  });
  await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
  expect(
    await page.evaluate(() =>
      getComputedStyle(document.documentElement)
        .getPropertyValue("--bg")
        .trim(),
    ),
  ).toBe("#000");
  await noOverflow(page);
  await page.screenshot({
    path: "test-results/desktop-dark.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => {
    document.documentElement.style.fontSize = "34px";
  });
  await noOverflow(page);
  await expect(
    page
      .getByTestId("main-action")
      .getByRole("button", { name: "はじめる", exact: true }),
  ).toBeVisible();
});

test("one natural sentence saves a small action and separate start without extra fields", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await login(page);
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "追加", exact: true })
    .click();
  const input = page.getByLabel("課題名や、やりたいこと", { exact: true });
  await expect(input).toBeFocused();
  await expect(page.getByRole("textbox")).toHaveCount(1);
  await page.keyboard.insertText(
    "9月20日までに経済学レポート。明日の18時に少しだけやる",
  );
  await page.getByRole("button", { name: "課題を保存", exact: true }).click();
  const result = page.getByRole("region", { name: "保存結果" });
  await expect(
    result.getByRole("heading", { name: "経済学レポート", exact: true }),
  ).toBeVisible();
  await expect(result).toContainText("資料を1つ開く");
  await expect(result).toContainText("18:00");
  await expect(result).toContainText("未確認の候補");
  await expect(result).toContainText("Calendarは未接続");
  await expect(page.getByRole("textbox")).toHaveCount(0);
  const t = await taskData(page, "経済学レポート");
  expect(t.deadline.date).toBeNull();
  expect(t.deadline.confirmed).toBe(false);
  expect(t.planAt).toBeTruthy();
  expect(t.startPlan.origin).toBe("requested");
  await noOverflow(page);
  await page.screenshot({
    path: "test-results/intake-result-pc.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await noOverflow(page);
  await page.screenshot({
    path: "test-results/intake-result-mobile.png",
    fullPage: true,
  });
  await result.getByRole("button", { name: "予定を変更・取り消す" }).click();
  await page.getByRole("dialog").getByLabel("取り組む日時").fill("");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "この時間にする" })
    .click();
  await expect(result).toContainText("着手予定：未作成");
  const after = await taskData(page, "経済学レポート");
  expect(after.planAt).toBeNull();
  expect(after.deadline).toEqual(t.deadline);
});
