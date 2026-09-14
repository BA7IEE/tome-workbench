import { request, esc, can } from "./core";
import {
  editDictionary,
  dictionaryNames,
  dictionaryKeys,
  optionText,
  type DictionaryEntry,
  type DictionaryKind,
  type DictionarySelection,
} from "./dictionary-editor";

const uid = () => "dict-" + crypto.randomUUID();

export function dictionaryField(
  kind: DictionaryKind,
  id: string | undefined,
  label = "",
  raw = "",
  mode: "entry" | "filter" = "entry",
) {
  const key = dictionaryKeys[kind];
  const name = dictionaryNames[kind];
  const control = uid();
  const selectedLabel = label || raw;
  const placeholder = mode === "filter" ? `全部${name}` : `请选择${name}`;
  if (kind !== "BRAND") {
    return `<div class="field dictionary-field dictionary-fixed" data-control="select" data-dictionary="${kind}" data-mode="${mode}" data-raw="${esc(raw)}" data-selected-label="${esc(selectedLabel)}">
      <label><span>${name}</span><select id="${control}" class="dictionary-select" name="dict_${key}" aria-label="${name}"><option value="">${placeholder}</option>${id ? `<option value="${esc(id)}" selected>${esc(selectedLabel || "正在读取当前选项…")}</option>` : ""}</select></label>
      <small class="dictionary-description" role="status">正在读取选项…</small>
      <div class="dictionary-fixed-actions"><button class="btn subtle dictionary-retry" type="button" hidden>重新加载</button></div>
    </div>`;
  }
  const listbox = control + "-list";
  const searchPlaceholder = mode === "filter" ? `全部${name}` : `搜索或选择${name}`;
  return `<div class="field dictionary-field dictionary-searchable" data-control="search" data-dictionary="${kind}" data-mode="${mode}" data-raw="${esc(raw)}" data-selected-label="${esc(selectedLabel)}">
    <span class="dictionary-label" id="${control}-label">${name}</span>
    <div class="dictionary-combobox">
      <input id="${control}" class="dictionary-input" type="text" role="combobox" aria-labelledby="${control}-label" aria-controls="${listbox}" aria-expanded="false" aria-autocomplete="list" autocomplete="off" spellcheck="false" placeholder="${searchPlaceholder}" value="${esc(selectedLabel)}">
      <input type="hidden" name="dict_${key}" value="${esc(id || "")}">
      <button class="dictionary-clear" type="button" aria-label="清除${name}" ${selectedLabel ? "" : "hidden"}>×</button>
      <div class="dictionary-menu" hidden>
        <div id="${listbox}" class="dictionary-options" role="listbox" aria-label="${name}选项"></div>
        <div class="dictionary-menu-footer">
          <button class="btn subtle dictionary-more" type="button" hidden>加载更多</button>
          <button class="btn subtle dictionary-retry" type="button" hidden>重新加载</button>
          ${mode === "entry" && can("dictionary") ? `<button class="btn subtle dictionary-add" type="button">新增${name}</button>` : ""}
        </div>
      </div>
    </div>
    <small class="dictionary-description" role="status">正在读取选项…</small>
  </div>`;
}

async function bindFixedDictionary(
  form: HTMLFormElement,
  root: HTMLElement,
  kind: DictionaryKind,
  signal: AbortSignal,
) {
  const select = root.querySelector<HTMLSelectElement>(".dictionary-select")!;
  const help = root.querySelector<HTMLElement>(".dictionary-description")!;
  const retry = root.querySelector<HTMLButtonElement>(".dictionary-retry")!;
  const entries = new Map<string, DictionaryEntry>();
  let generation = 0;
  let raw = root.dataset.raw || "";
  const category = () =>
    (form.elements.namedItem("category") as HTMLSelectElement | null)?.value || "";
  const describe = () => {
    const entry = entries.get(select.value);
    help.hidden = root.dataset.mode === "filter";
    if (root.dataset.invalid === "true") {
      help.hidden = false;
      help.textContent = "当前选项不适用于已选品类，请重新选择。";
    } else if (entry) {
      help.textContent = `${entry.active ? "" : "此选项已停用，仅保留现有记录。"}${entry.description || optionText(entry)}`;
    } else if (kind === "CONDITION") {
      help.hidden = root.dataset.mode === "filter";
      help.textContent = "VC五级口径；具体瑕疵仍需单独填写。";
    } else {
      help.hidden = true;
      help.textContent = "";
    }
  };
  const load = async () => {
    const g = ++generation;
    const currentId = select.value;
    retry.hidden = true;
    root.dataset.ready = "false";
    root.dataset.invalid = "false";
    try {
      const first = await request<{ rows: DictionaryEntry[]; total: number }>(
        `/dictionaries?kind=${kind}&category=${category()}&page=1`,
      );
      if (signal.aborted || g !== generation || !root.isConnected) return;
      const rows = [...first.rows];
      for (let page = 2; rows.length < first.total && page <= 5; page++) {
        const more = await request<{ rows: DictionaryEntry[]; total: number }>(
          `/dictionaries?kind=${kind}&category=${category()}&page=${page}`,
        );
        if (signal.aborted || g !== generation || !root.isConnected) return;
        rows.push(...more.rows);
      }
      entries.clear();
      for (const entry of rows) entries.set(entry.id, entry);
      let current = currentId ? entries.get(currentId) : undefined;
      if (currentId && !current) {
        current = await request<DictionaryEntry>(`/dictionaries/${currentId}`);
        if (signal.aborted || g !== generation || !root.isConnected) return;
        entries.set(current.id, current);
      }
      if (raw && !currentId) {
        const exact = await request<{ rows: DictionaryEntry[] }>(
          `/dictionaries?kind=${kind}&q=${encodeURIComponent(raw)}&exact=1&category=${category()}`,
        );
        if (signal.aborted || g !== generation || !root.isConnected) return;
        if (exact.rows.length === 1) {
          current = exact.rows[0];
          entries.set(current.id, current);
        }
        raw = "";
      }
      select.replaceChildren(new Option(root.dataset.mode === "filter" ? `全部${dictionaryNames[kind]}` : `请选择${dictionaryNames[kind]}`, ""));
      for (const entry of rows) {
        const option = new Option(optionText(entry), entry.id);
        option.dataset.label = entry.label;
        select.add(option);
      }
      if (current && !rows.some((entry) => entry.id === current!.id)) {
        const option = new Option(`${optionText(current)}${current.active ? "（不适用于当前品类）" : "（已停用）"}`, current.id);
        option.dataset.label = current.label;
        select.add(option);
        root.dataset.invalid = current.active ? "true" : "false";
      }
      if (current) {
        select.value = current.id;
        root.dataset.selectedLabel = current.label;
      } else {
        select.value = "";
        root.dataset.selectedLabel = "";
      }
      root.dataset.ready = "true";
      describe();
    } catch (error) {
      if (signal.aborted || g !== generation) return;
      help.hidden = false;
      help.textContent = `选项读取失败：${(error as Error).message}`;
      retry.hidden = false;
      root.dataset.ready = "false";
    }
  };
  select.addEventListener("change", () => {
    const entry = entries.get(select.value);
    root.dataset.selectedLabel = entry?.label || "";
    root.dataset.invalid = "false";
    describe();
  }, { signal });
  retry.addEventListener("click", () => void load(), { signal });
  root.querySelector(".dictionary-add")?.addEventListener("click", () =>
    editDictionary(kind, undefined, async (entry) => {
      entries.set(entry.id, entry);
      const option = new Option(optionText(entry), entry.id);
      option.dataset.label = entry.label;
      select.add(option);
      select.value = entry.id;
      root.dataset.selectedLabel = entry.label;
      root.dataset.ready = "true";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    }), { signal });
  form.querySelector('[name="category"]')?.addEventListener("change", () => void load(), { signal });
  await load();
}

export function bindDictionaryFields(
  form: HTMLFormElement,
  signal: AbortSignal,
) {
  for (const root of form.querySelectorAll<HTMLElement>("[data-dictionary]")) {
    if (root.dataset.bound === "true") continue;
    root.dataset.bound = "true";
    const kind = root.dataset.dictionary as DictionaryKind;
    if (root.dataset.control === "select") {
      void bindFixedDictionary(form, root, kind, signal);
      continue;
    }
    const input = root.querySelector<HTMLInputElement>(".dictionary-input")!;
    const hidden = root.querySelector<HTMLInputElement>(
      'input[type="hidden"]',
    )!;
    const menu = root.querySelector<HTMLElement>(".dictionary-menu")!;
    const list = root.querySelector<HTMLElement>(".dictionary-options")!;
    const help = root.querySelector<HTMLElement>(".dictionary-description")!;
    const more = root.querySelector<HTMLButtonElement>(".dictionary-more")!;
    const retry = root.querySelector<HTMLButtonElement>(".dictionary-retry")!;
    const clear = root.querySelector<HTMLButtonElement>(".dictionary-clear")!;
    const entries = new Map<string, DictionaryEntry>();
    let results: DictionaryEntry[] = [];
    let page = 1;
    let total = 0;
    let query = "";
    let generation = 0;
    let activeIndex = -1;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let raw = root.dataset.raw || "";

    const selectedEntry = () => entries.get(hidden.value);
    const selectedText = () => root.dataset.selectedLabel || "";
    const updateClear = () => (clear.hidden = !input.value);
    const setExpanded = (open: boolean) => {
      menu.hidden = !open;
      input.setAttribute("aria-expanded", String(open));
      if (!open) {
        activeIndex = -1;
        input.removeAttribute("aria-activedescendant");
      }
    };
    const describe = () => {
      const entry = selectedEntry();
      help.hidden = root.dataset.mode === "filter";
      if (entry) {
        help.hidden = root.dataset.mode === "filter";
        help.textContent = `${entry.active ? "" : "此选项已停用，仅保留现有记录。"}${entry.description || ""}`;
        if (!help.textContent) help.hidden = true;
      } else {
        help.hidden = true;
        help.textContent = "";
      }
    };

    const choose = (entry: DictionaryEntry) => {
      clearTimeout(timer);
      generation++;
      entries.set(entry.id, entry);
      hidden.value = entry.id;
      input.value = optionText(entry);
      root.dataset.selectedLabel = entry.label;
      query = "";
      activeIndex = -1;
      root.dataset.ready = "true";
      updateClear();
      describe();
      setExpanded(false);
      hidden.dispatchEvent(new Event("change", { bubbles: true }));
    };

    const clearSelection = (open = false) => {
      clearTimeout(timer);
      generation++;
      hidden.value = "";
      input.value = "";
      root.dataset.selectedLabel = "";
      query = "";
      activeIndex = -1;
      updateClear();
      describe();
      hidden.dispatchEvent(new Event("change", { bubbles: true }));
      setExpanded(open);
    };
    const render = () => {
      if (!results.length) {
        list.innerHTML = `<div class="dictionary-empty">${query ? "没有匹配项" : "暂无可选项"}</div>`;
      } else {
        list.innerHTML = results
          .map(
            (entry, index) =>
              `<button id="${input.id}-option-${entry.id}" type="button" role="option" class="dictionary-option ${index === activeIndex ? "active" : ""}" data-dictionary-id="${entry.id}" aria-selected="${hidden.value === entry.id}">
              <span>${esc(optionText(entry))}</span>${entry.description ? `<small>${esc(entry.description)}</small>` : ""}
            </button>`,
          )
          .join("");
      }
      more.hidden = results.length >= total;
      more.disabled = false;
      retry.hidden = true;
    };

    const load = async (append = false) => {
      const g = ++generation;
      const category =
        (form.elements.namedItem("category") as HTMLSelectElement | null)
          ?.value || "";
      root.dataset.ready = "false";
      more.disabled = true;
      try {
        const data = await request<{ rows: DictionaryEntry[]; total: number }>(
          `/dictionaries?kind=${kind}&q=${encodeURIComponent(query)}&category=${category}&page=${page}`,
        );
        if (signal.aborted || g !== generation || !root.isConnected) return;
        for (const entry of data.rows) entries.set(entry.id, entry);
        results = append
          ? [
              ...results,
              ...data.rows.filter((e) => !results.some((r) => r.id === e.id)),
            ]
          : data.rows;
        total = data.total;
        if (hidden.value) {
          let current = entries.get(hidden.value);
          if (!current) {
            current = await request<DictionaryEntry>(`/dictionaries/${hidden.value}`);
            if (signal.aborted || g !== generation || !root.isConnected) return;
            entries.set(current.id, current);
          }
          input.value = optionText(current);
          root.dataset.selectedLabel = current.label;
        }
        if (raw && !hidden.value) {
          const exact = await request<{ rows: DictionaryEntry[] }>(
            `/dictionaries?kind=${kind}&q=${encodeURIComponent(raw)}&exact=1&category=${category}`,
          );
          if (signal.aborted || g !== generation || !root.isConnected) return;
          if (exact.rows.length === 1) choose(exact.rows[0]);
          raw = "";
        }
        root.dataset.ready = "true";
        render();
        describe();
        updateClear();
      } catch (error) {
        if (signal.aborted || g !== generation) return;
        help.hidden = false;
        help.textContent = `选项读取失败：${(error as Error).message}`;
        retry.hidden = false;
        root.dataset.ready = "false";
      }
    };

    const search = () => {
      clearTimeout(timer);
      generation++;
      page = 1;
      query = input.value.trim();
      results = [];
      activeIndex = -1;
      more.hidden = true;
      list.innerHTML = '<div class="dictionary-empty">正在搜索…</div>';
      timer = setTimeout(() => void load(false), 160);
    };
    const activate = (next: number) => {
      if (!results.length) return;
      activeIndex = Math.max(0, Math.min(results.length - 1, next));
      input.setAttribute(
        "aria-activedescendant",
        `${input.id}-option-${results[activeIndex].id}`,
      );
      render();
      list
        .querySelector<HTMLElement>(
          `[data-dictionary-id="${results[activeIndex].id}"]`,
        )
        ?.scrollIntoView({ block: "nearest" });
    };

    input.addEventListener(
      "beforeinput",
      (event) => {
        if (
          hidden.value &&
          event.inputType.startsWith("insert") &&
          input.selectionStart === input.selectionEnd
        ) {
          const inserted = event.data ?? event.dataTransfer?.getData("text/plain") ?? "";
          if (!inserted) return;
          event.preventDefault();
          hidden.value = "";
          root.dataset.selectedLabel = "";
          input.value = inserted;
          input.setSelectionRange(inserted.length, inserted.length);
          updateClear();
          input.dispatchEvent(new Event("input", { bubbles: true }));
        }
      },
      { signal },
    );
    input.addEventListener(
      "focus",
      () => {
        if (hidden.value) input.select();
        query = hidden.value ? "" : input.value.trim();
        setExpanded(true);
        if (!results.length || query) {
          page = 1;
          void load(false);
        } else render();
      },
      { signal },
    );

    input.addEventListener(
      "input",
      () => {
        if (input.value !== selectedText()) {
          hidden.value = "";
          root.dataset.selectedLabel = "";
        }
        updateClear();
        setExpanded(true);
        search();
      },
      { signal },
    );
    input.addEventListener(
      "keydown",
      (event) => {
        if (event.key === "ArrowDown") {
          event.preventDefault();
          setExpanded(true);
          activate(activeIndex + 1);
        } else if (event.key === "ArrowUp") {
          event.preventDefault();
          activate(activeIndex <= 0 ? results.length - 1 : activeIndex - 1);
        } else if (event.key === "Enter" && !menu.hidden) {
          if (activeIndex >= 0 && results[activeIndex]) {
            event.preventDefault();
            choose(results[activeIndex]);
          } else if (results.length === 1) {
            event.preventDefault();
            choose(results[0]);
          }
        } else if (event.key === "Escape") {
          setExpanded(false);
        }
      },
      { signal },
    );

    list.addEventListener(
      "click",
      (event) => {
        const option = (event.target as Element).closest<HTMLElement>(
          "[data-dictionary-id]",
        );
        if (!option) return;
        const entry = entries.get(option.dataset.dictionaryId!);
        if (entry) choose(entry);
      },
      { signal },
    );
    clear.addEventListener(
      "click",
      () => {
        clearSelection(true);
        page = 1;
        void load(false);
        input.focus();
      },
      { signal },
    );

    more.addEventListener(
      "click",
      () => {
        page++;
        void load(true);
      },
      { signal },
    );
    retry.addEventListener(
      "click",
      () => {
        page = 1;
        void load(false);
      },
      { signal },
    );

    root
      .querySelector(".dictionary-add")
      ?.addEventListener(
        "click",
        () =>
          editDictionary(
            kind,
            undefined,
            async (entry) => choose(entry),
            input.value.trim(),
          ),
        { signal },
      );

    form.querySelector('[name="category"]')?.addEventListener(
      "change",
      () => {
        page = 1;
        query = "";
        void load(false);
      },
      { signal },
    );
    document.addEventListener(
      "pointerdown",
      (event) => {
        if (!root.contains(event.target as Node)) setExpanded(false);
      },
      { signal },
    );

    signal.addEventListener("abort", () => clearTimeout(timer), { once: true });

    void load(false);
  }
}

export function readDictionarySelections(form: HTMLFormElement): {
  dictionary: DictionarySelection;
  labels: Record<string, string>;
} {
  const dictionary: DictionarySelection = {};
  const labels: Record<string, string> = {};
  for (const root of form.querySelectorAll<HTMLElement>("[data-dictionary]")) {
    const kind = root.dataset.dictionary as DictionaryKind;
    const key = dictionaryKeys[kind];
    const fixed = root.querySelector<HTMLSelectElement>(".dictionary-select");
    if (fixed) {
      if (root.dataset.invalid === "true") {
        fixed.focus();
        throw new Error(`${dictionaryNames[kind]}不适用于当前品类，请重新选择`);
      }
      dictionary[key] = fixed.value || null;
      labels[key] = fixed.value ? root.dataset.selectedLabel || fixed.selectedOptions[0]?.dataset.label || fixed.selectedOptions[0]?.textContent || "" : "";
      continue;
    }
    const hidden = root.querySelector<HTMLInputElement>(`[name="dict_${key}"]`)!;
    const input = root.querySelector<HTMLInputElement>(".dictionary-input")!;
    if (input.value.trim() && !hidden.value) {
      input.focus();
      throw new Error(`请从建议中选择${dictionaryNames[kind]}；输入文字不会直接保存`);
    }
    dictionary[key] = hidden.value || null;
    labels[key] = hidden.value ? root.dataset.selectedLabel || input.value : "";
  }
  return { dictionary, labels };
}

export function dictionaryFilterField(kind: DictionaryKind, id?: string) {
  return dictionaryField(kind, id, "", "", "filter");
}
