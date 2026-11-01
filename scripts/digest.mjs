// Daily digest: new open-source projects on GitHub that are gaining stars fastest,
// each with a one-line Bulgarian explanation, plus a short overview of what is new today.
// Runs in GitHub Actions (Node 20+, no dependencies).
import fs from "node:fs";
import path from "node:path";

const TOKEN = process.env.GITHUB_TOKEN;
const MODEL = process.env.DIGEST_MODEL || "openai/gpt-4o-mini";
const MAX_ITEMS = Number(process.env.DIGEST_MAX || 25);
const LOOKBACK_DAYS = 7; // projects created in the last week that are taking off
const SEEN_FILE = "data/seen.json";

const today = new Date().toISOString().slice(0, 10);
const since = new Date(Date.now() - LOOKBACK_DAYS * 864e5).toISOString().slice(0, 10);
const headers = { Accept: "application/vnd.github+json", "User-Agent": "open-sorse-all-new", ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}) };

const readJson = (f, d) => { try { return JSON.parse(fs.readFileSync(f, "utf-8")); } catch { return d; } };
const writeFile = (f, s) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, s, "utf-8"); };
const oneLine = s => String(s || "").replace(/[\r\n|]+/g, " ").replace(/\s+/g, " ").trim();

async function searchNew() {
  const q = encodeURIComponent(`created:>=${since} stars:>=20 fork:false archived:false is:public`);
  const items = [];
  for (let page = 1; page <= 2; page++) {
    const r = await fetch(`https://api.github.com/search/repositories?q=${q}&sort=stars&order=desc&per_page=100&page=${page}`, { headers });
    if (!r.ok) throw new Error(`GitHub search: HTTP ${r.status} ${await r.text()}`);
    const data = await r.json();
    items.push(...data.items);
    if (data.items.length < 100) break;
  }
  return items;
}

async function explain(repos) {
  const list = repos.map(r => ({ name: r.full_name, description: oneLine(r.description).slice(0, 300), language: r.language, topics: (r.topics || []).slice(0, 8), stars: r.stargazers_count }));
  const prompt = `Ето нови open-source проекти от GitHub, качени през последната седмица и набиращи звезди най-бързо.
Върни САМО JSON, без markdown:
{"overview":"2-4 изречения на български: какво е новото днес като цяло — кои теми и тенденции се виждат",
 "items":[{"name":"owner/repo","bg":"едно кратко изречение на български (до 20 думи): какво е и за какво служи","category":"една дума на български: AI, Агенти, Инструменти, Уеб, Сигурност, Данни, Игри, Образование, Друго"}]}
Не измисляй — ако описанието е празно или неясно, напиши "Без описание — неясно за какво е." Запази имената точно.
Проекти:
${JSON.stringify(list)}`;
  const r = await fetch("https://models.github.ai/inference/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify({ model: MODEL, temperature: 0.2, response_format: { type: "json_object" }, messages: [{ role: "user", content: prompt }] }),
  });
  if (!r.ok) throw new Error(`GitHub Models: HTTP ${r.status} ${(await r.text()).slice(0, 300)}`);
  const text = (await r.json()).choices[0].message.content;
  const start = text.indexOf("{"), end = text.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error(`моделът не върна JSON: ${text.slice(0, 200)}`);
  return JSON.parse(text.slice(start, end + 1));
}

function render(repos, ai) {
  const byName = new Map((ai?.items || []).map(i => [String(i.name).toLowerCase(), i]));
  const rows = repos.map((r, n) => {
    const i = byName.get(r.full_name.toLowerCase());
    const what = oneLine(i?.bg) || oneLine(r.description) || "Без описание.";
    return `| ${n + 1} | [${r.full_name}](${r.html_url}) | ${oneLine(i?.category) || "—"} | ${what} | ${r.language || "—"} | ⭐ ${r.stargazers_count} |`;
  });
  const overview = oneLine(ai?.overview) || "_Резюмето не се генерира днес — по-долу са оригиналните описания._";
  return `# Ново в open source — ${today}

${overview}

| # | Проект | Тема | Какво е | Език | Звезди |
|---|---|---|---|---|---|
${rows.join("\n")}

_Нови публични проекти, създадени след ${since}, подредени по звезди; всеки проект влиза само веднъж._
`;
}

function updateReadme(latest) {
  const files = fs.existsSync("digest") ? fs.readdirSync("digest", { recursive: true }).filter(f => f.endsWith(".md")).map(f => f.replace(/\\/g, "/")).sort().reverse() : [];
  const archive = files.slice(0, 60).map(f => `- [${f.replace(/\.md$/, "").replace("/", "-")}](digest/${f})`).join("\n");
  writeFile("README.md", `# Open source — всичко ново

Всеки ден автоматично: новите open-source проекти в GitHub, които набират звезди най-бързо, с кратко обяснение на български какво е всеки и общо резюме какво е новото.

---

${latest.replace(/^# .*\n/, `## Днес (${today})\n`)}
---

## Архив

${archive}
`);
}

const seen = readJson(SEEN_FILE, {});
const fresh = (await searchNew()).filter(r => !seen[r.full_name] || seen[r.full_name] === today).slice(0, MAX_ITEMS);
if (!fresh.length) { console.log("Няма нови проекти днес."); process.exit(0); }

let ai = null;
try { ai = await explain(fresh); } catch (e) { console.error(`Резюмето не стана: ${e.message}`); }

const md = render(fresh, ai);
writeFile(`digest/${today.slice(0, 4)}/${today.slice(5)}.md`, md);
for (const r of fresh) seen[r.full_name] = today;
writeFile(SEEN_FILE, JSON.stringify(seen, null, 1));
updateReadme(md);
console.log(`Записани ${fresh.length} проекта, резюме: ${ai ? "да" : "не"}`);
