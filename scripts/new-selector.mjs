#!/usr/bin/env node
/**
 * 選者をマスタに登録する対話式スクリプト。
 *
 *   npm run new:selector
 *
 * 選者は記事から独立したマスタなので、記事を書く前に単独で登録できる。
 * （記事作成の途中でも登録できるが、そちらは記事を書く流れの中にある）
 *
 * 既存の選者を選ぶと、その内容を編集できる。
 * 所属や略歴が変わったときはここから直せば、全記事に反映される。
 */
import path from "node:path";
import process from "node:process";
import {
  ask,
  askRequired,
  chooseFromList,
  closeInput,
  promptSelector,
  readJson,
  writeJson,
} from "./lib/prompt.mjs";

const ROOT = process.cwd();
const SELECTORS_PATH = path.join(ROOT, "src/data/selectors.json");

async function main() {
  const selectors = readJson(SELECTORS_PATH);
  const ids = Object.keys(selectors);

  console.log("\n選者をマスタに登録します。Ctrl+C でいつでも中断できます。");

  if (ids.length === 0) {
    console.log("\n■ 最初の選者を登録します");
    const { id, selector } = await promptSelector(ids);
    selectors[id] = selector;
    writeJson(SELECTORS_PATH, selectors);
    report(id, selector);
    closeInput();
    return;
  }

  const choice = await chooseFromList(
    "\n■ 新しく登録するか、既存の選者を編集するかを選んでください",
    ids.map((id) => ({
      label: `${selectors[id].name}（${selectors[id].affiliation}）  [${id}]`,
      value: id,
    })),
    { allowNew: true, newLabel: "新しい選者を登録する" },
  );

  if (choice.isNew) {
    console.log("\n■ 新しい選者を登録します");
    const { id, selector } = await promptSelector(ids);
    selectors[id] = selector;
    writeJson(SELECTORS_PATH, selectors);
    report(id, selector);
    closeInput();
    return;
  }

  // --- 既存の編集 ---
  const id = choice.value;
  const current = selectors[id];
  console.log(
    `\n■ ${current.name} を編集します（Enterで現在の値のまま）\n` +
      "  ※ IDは変更できません。変えるとURLが変わり、公開済みのリンクが切れます",
  );

  const name = await askRequired("  氏名", current.name);
  const reading = (
    await ask(
      `  ふりがな（任意）${current.reading ? `（現在: ${current.reading}）` : ""}: `,
    )
  ).trim();
  const affiliation = await askRequired("  所属", current.affiliation);
  const bio = await askRequired("  略歴", current.bio);
  const credentials = await askRequired(
    "  この人が詳しい理由",
    current.credentials,
  );
  const avatar = (
    await ask(
      `  顔写真のファイル名（任意）${current.avatar ? `（現在: ${current.avatar}）` : ""}: `,
    )
  ).trim();
  const x = (
    await ask(
      `  Xのハンドル（任意）${current.links?.x ? `（現在: ${current.links.x}）` : ""}: `,
    )
  ).trim();
  const site = (
    await ask(
      `  サイトURL（任意）${current.links?.site ? `（現在: ${current.links.site}）` : ""}: `,
    )
  ).trim();

  const nextReading = reading || current.reading;
  const nextAvatar = avatar || current.avatar;
  const nextX = x || current.links?.x;
  const nextSite = site || current.links?.site;

  selectors[id] = {
    name,
    ...(nextReading ? { reading: nextReading } : {}),
    affiliation,
    bio,
    credentials,
    ...(nextAvatar ? { avatar: nextAvatar } : {}),
    ...(nextX || nextSite
      ? {
          links: {
            ...(nextX ? { x: nextX } : {}),
            ...(nextSite ? { site: nextSite } : {}),
          },
        }
      : {}),
  };

  writeJson(SELECTORS_PATH, selectors);
  report(id, selectors[id]);
  closeInput();
}

function report(id, selector) {
  console.log(`\n✓ src/data/selectors.json に保存しました\n`);
  console.log(`  ID    : ${id}`);
  console.log(`  氏名  : ${selector.name}`);
  console.log(`  所属  : ${selector.affiliation}`);
  console.log(`  URL   : /selectors/${id}/`);
  if (selector.avatar) {
    console.log(`  写真  : public/selectors/${selector.avatar}`);
  }
  console.log(
    "\n※ 選者ページは**記事が1本以上ある場合のみ**生成されます。" +
      "\n  記事を作るには npm run new:article\n",
  );
}

main().catch((err) => {
  console.error("\nエラー:", err.message);
  closeInput();
  process.exit(1);
});
