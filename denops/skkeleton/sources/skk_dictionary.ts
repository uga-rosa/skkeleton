import { getKanaTable } from "../kana.ts";
import { readFileWithEncoding } from "../util.ts";
import type { CompletionData } from "../types.ts";
import {
  Dictionary,
  HenkanType,
  okuriAriMarker,
  okuriNasiMarker,
} from "../dictionary.ts";
import { jisyoschema, jsonschema, msgpack, yaml } from "../deps/dictionary.ts";

interface Jisyo {
  okuri_ari: Record<string, string[]>;
  okuri_nasi: Record<string, string[]>;
}

export class SkkDictionary implements Dictionary {
  #okuriAri: Map<string, string[]>;
  #okuriNasi: Map<string, string[]>;

  #cachedCandidates: Map<string, CompletionData>;

  constructor(
    okuriAri?: Map<string, string[]>,
    okuriNasi?: Map<string, string[]>,
  ) {
    this.#okuriAri = okuriAri ?? new Map();
    this.#okuriNasi = okuriNasi ?? new Map();
    this.#cachedCandidates = new Map();
  }

  getHenkanResult(type: HenkanType, word: string): Promise<string[]> {
    const target = type === "okuriari" ? this.#okuriAri : this.#okuriNasi;
    return Promise.resolve(target.get(word) ?? []);
  }

  getCompletionResult(prefix: string, feed: string): Promise<CompletionData> {
    const candidates: CompletionData = [];
    if (feed != "") {
      const table = getKanaTable();
      for (const [key, kanas] of table) {
        if (key.startsWith(feed) && kanas.length > 1) {
          const feedPrefix = prefix + (kanas as string[])[0];
          for (const entry of this.getCachedCandidates(prefix[0])) {
            if (entry[0].startsWith(feedPrefix)) {
              candidates.push(entry);
            }
          }
        }
      }
    } else {
      for (const entry of this.getCachedCandidates(prefix[0])) {
        if (entry[0].startsWith(prefix)) {
          candidates.push(entry);
        }
      }
    }

    candidates.sort((a, b) => a[0].localeCompare(b[0]));
    return Promise.resolve(candidates);
  }

  private getCachedCandidates(prefix: string): CompletionData {
    if (this.#cachedCandidates.has(prefix)) {
      const candidates = this.#cachedCandidates.get(prefix);
      return candidates ?? [];
    }

    const candidates: CompletionData = [];
    for (const entry of this.#okuriNasi) {
      if (entry[0].startsWith(prefix)) {
        candidates.push(entry);
      }
    }

    this.#cachedCandidates.set(prefix, candidates);
    return candidates;
  }

  async load(path: string, encoding: string) {
    if (path.endsWith(".yaml") || path.endsWith(".yml")) {
      const file = await Deno.readTextFile(path);
      this.loadYaml(file);
    } else if (path.endsWith(".json")) {
      const file = await Deno.readTextFile(path);
      this.loadJson(file);
    } else if (path.endsWith(".mpk")) {
      const file = await Deno.readFile(path);
      this.loadMsgpack(file);
    } else {
      const file = await readFileWithEncoding(path, encoding);
      this.loadString(file);
    }

    return this;
  }

  private loadJson(data: string) {
    const jisyo = JSON.parse(data) as Jisyo;
    const validator = new jsonschema.Validator();
    const result = validator.validate(jisyo, jisyoschema);
    if (!result.valid) {
      for (const error of result.errors) {
        throw Error(error.message);
      }
    }
    this.#okuriAri = new Map(Object.entries(jisyo.okuri_ari));
    this.#okuriNasi = new Map(Object.entries(jisyo.okuri_nasi));
  }

  private loadYaml(data: string) {
    const jisyo = yaml.parse(data) as Jisyo;
    const validator = new jsonschema.Validator();
    const result = validator.validate(jisyo, jisyoschema);
    if (!result.valid) {
      for (const error of result.errors) {
        throw Error(error.message);
      }
    }
    this.#okuriAri = new Map(Object.entries(jisyo.okuri_ari));
    this.#okuriNasi = new Map(Object.entries(jisyo.okuri_nasi));
  }

  private loadMsgpack(data: Uint8Array) {
    const jisyo = msgpack.decode(data) as Jisyo;
    const validator = new jsonschema.Validator();
    const result = validator.validate(jisyo, jisyoschema);
    if (!result.valid) {
      for (const error of result.errors) {
        throw Error(error.message);
      }
    }
    this.#okuriAri = new Map(Object.entries(jisyo.okuri_ari));
    this.#okuriNasi = new Map(Object.entries(jisyo.okuri_nasi));
  }

  private loadString(data: string) {
    this.#okuriAri = new Map();
    this.#okuriNasi = new Map();

    let mode: 0 | 1 | -1 = -1;
    const a: Map<string, string[]>[] = [this.#okuriAri, this.#okuriNasi];
    for (const line of data.split(/\n|\r\n/)) {
      if (line === okuriAriMarker) {
        mode = 0;
        continue;
      }

      if (line === okuriNasiMarker) {
        mode = 1;
        continue;
      }

      if (mode == -1) continue;

      const pos = line.indexOf(" ");
      if (pos !== -1) {
        a[mode].set(line.substring(0, pos), line.slice(pos + 2, -1).split("/"));
      }
    }
  }
}
