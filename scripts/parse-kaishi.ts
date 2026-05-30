import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const INPUT_FILE = join(process.cwd(), "kaishi-1.5k.txt");
const OUTPUT_FILE = join(process.cwd(), "src", "lib", "client", "stores", "kaishiPool.json");

async function run() {
  console.log("📂 Parsing Kaishi 1.5k deck...");
  if (!existsSync(INPUT_FILE)) {
    console.error(`❌ Error: Input file not found at ${INPUT_FILE}`);
    process.exit(1);
  }

  const content = readFileSync(INPUT_FILE, "utf-8");
  const lines = content.split(/\r?\n/);
  const pool: string[] = [];

  for (const line of lines) {
    if (!line.trim() || line.startsWith("#")) {
      continue;
    }

    const cols = line.split("\t");
    if (cols.length < 4) {
      continue;
    }

    const kanji = cols[1]?.trim() || "";
    const kana = cols[2]?.trim() || "";
    const meaning = cols[3]?.trim() || "";

    // Skip welcome/instruction card or anything empty
    if (kanji.includes("Welcome to Kaishi") || !kana || !meaning) {
      continue;
    }

    // Clean meaning of HTML tags and quotes
    const cleanMeaning = meaning
      .replace(/<[^>]*>/g, "")
      .replace(/""/g, '"')
      .trim();

    let entry = "";
    if (!kanji || kanji === kana) {
      entry = `${kana} - ${cleanMeaning}`;
    } else {
      entry = `${kanji} (${kana}) - ${cleanMeaning}`;
    }

    pool.push(entry);
  }

  console.log(`✨ Successfully parsed ${pool.length} vocabulary entries.`);
  writeFileSync(OUTPUT_FILE, JSON.stringify(pool, null, 2), "utf-8");
  console.log(`💾 Saved compact JSON to ${OUTPUT_FILE}`);
}

void run();
