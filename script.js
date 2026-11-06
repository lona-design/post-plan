(() => {
  "use strict";

  const STORAGE_KEY = "postplan-data-v1";
  const STATUS_ORDER = ["idea", "drafting", "ready", "posted"];
  const LABELS = {
    platform: { instagram: "Instagram", youtube: "YouTube", facebook: "Facebook" },
    status: { idea: "Idea", drafting: "Drafting", ready: "Ready", posted: "Posted" },
    type: { reel: "Reel / Short", video: "Video", post: "Post", story: "Story", carousel: "Carousel", other: "Other" },
    pillar: { lifestyle: "Lifestyle", travel: "Travel", food: "Food", education: "Education", personal: "Personal", other: "Other" }
  };
  const elements = {
    counts: document.querySelectorAll("[data-count]"),
    list: document.querySelector("#content-list"),
    empty: document.querySelector("#empty-state"),
    noResults: document.querySelector("#no-results"),
    search: document.querySelector("#search-input"),
    searchClear: document.querySelector("#search-clear"),
    platformFilter: document.querySelector("#platform-filter"),
    statusFilter: document.querySelector("#status-filter"),
    dateFilter: document.querySelector("#date-filter"),
    sort: document.querySelector("#sort-select"),
    starredFilter: document.querySelector("#starred-filter"),
    results: document.querySelector("#results-context"),
    clearFilters: document.querySelector("#clear-filters"),
    upcoming: document.querySelector("#upcoming-section"),
    upcomingList: document.querySelector("#upcoming-list"),
    upcomingSummary: document.querySelector("#upcoming-summary"),
    editor: document.querySelector("#editor-dialog"),
    editorForm: document.querySelector("#editor-form"),
    editorHeading: document.querySelector("#editor-heading"),
    editorKicker: document.querySelector("#editor-kicker"),
    title: document.querySelector("#title-input"),
    platform: document.querySelector("#platform-input"),
    type: document.querySelector("#type-input"),
    date: document.querySelector("#date-input"),
    status: document.querySelector("#status-input"),
    pillar: document.querySelector("#pillar-input"),
    notes: document.querySelector("#notes-input"),
    starred: document.querySelector("#starred-input"),
    titleError: document.querySelector("#title-error"),
    dateError: document.querySelector("#date-error"),
    save: document.querySelector("#save-button"),
    confirm: document.querySelector("#confirm-dialog"),
    confirmHeading: document.querySelector("#confirm-heading"),
    confirmCopy: document.querySelector("#confirm-copy"),
    confirmDetails: document.querySelector("#confirm-details"),
    confirmActions: document.querySelector("#confirm-actions"),
    confirmSymbol: document.querySelector("#confirm-symbol"),
    restoreInput: document.querySelector("#restore-input"),
    toastRegion: document.querySelector("#toast-region")
  };

  let items = [];
  let storageAvailable = true;
  let editorMode = "add";
  let editingId = null;
  let editorSnapshot = "";
  let openMenu = null;
  let pendingDelete = null;
  let lastDeleted = null;
  let toastTimer;
  let importPayload = null;

  function makeId() {
    if (window.crypto && typeof window.crypto.randomUUID === "function") return window.crypto.randomUUID();
    return `pp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
  }

  function isValidDate(value) {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const [year, month, day] = value.split("-").map(Number);
    const date = new Date(year, month - 1, day);
    return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
  }

  function normalizeItem(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    if (typeof value.id !== "string" || !value.id || typeof value.title !== "string") return null;
    if (!Object.hasOwn(LABELS.platform, value.platform) || !Object.hasOwn(LABELS.status, value.status)) return null;
    const title = value.title.trim().slice(0, 160);
    if (!title) return null;
    const contentType = Object.hasOwn(LABELS.type, value.contentType) ? value.contentType : "";
    const pillar = Object.hasOwn(LABELS.pillar, value.pillar) ? value.pillar : "";
    const plannedDate = value.plannedDate == null || value.plannedDate === "" ? "" : isValidDate(value.plannedDate) ? value.plannedDate : null;
    if (plannedDate === null) return null;
    return {
      id: value.id,
      title,
      platform: value.platform,
      contentType,
      plannedDate,
      status: value.status,
      notes: typeof value.notes === "string" ? value.notes.slice(0, 4000) : "",
      pillar,
      starred: value.starred === true,
      createdAt: typeof value.createdAt === "string" ? value.createdAt : "",
      updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : ""
    };
  }

  function normalizeItems(records) {
    if (!Array.isArray(records)) return null;
    const ids = new Set();
    const normalized = [];
    for (const record of records) {
      const item = normalizeItem(record);
      if (!item || ids.has(item.id)) return null;
      ids.add(item.id);
      normalized.push(item);
    }
    return normalized;
  }

  function readStoredData() {
    let raw;
    try {
      raw = localStorage.getItem(STORAGE_KEY);
    } catch (error) {
      storageAvailable = false;
      toast("Local storage is unavailable. Changes may not persist.", "error");
      return [];
    }
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw);
      const records = Array.isArray(parsed) ? parsed : parsed && Array.isArray(parsed.items) ? parsed.items : null;
      const normalized = normalizeItems(records);
      if (!normalized) throw new Error("Stored content has an invalid format.");
      return normalized;
    } catch (error) {
      storageAvailable = false;
      showRecoveryMessage("Saved PostPlan data could not be read. Your original data has been left untouched. Export or remove the corrupted value from browser storage to continue saving.");
      return [];
    }
  }

  function persist(nextItems, successMessage) {
    if (!storageAvailable) {
      toast("Could not save: local storage is unavailable.", "error");
      return false;
    }
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(nextItems));
      items = nextItems;
      render();
      if (successMessage) toast(successMessage);
      return true;
    } catch (error) {
      toast("Could not save your changes. Check browser storage space and try again.", "error");
      return false;
    }
  }

  function showRecoveryMessage(message) {
    elements.confirmHeading.textContent = "Saved data needs attention";
    elements.confirmCopy.textContent = message;
    elements.confirmSymbol.textContent = "!";
    elements.confirmDetails.hidden = true;
    elements.confirmActions.replaceChildren();
    const close = makeButton("Close", "button button-secondary", () => elements.confirm.close());
    elements.confirmActions.append(close);
    elements.confirm.showModal();
  }

  function localToday() {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  }

  function parseLocalDate(value) {
    if (!isValidDate(value)) return null;
    const [year, month, day] = value.split("-").map(Number);
    return new Date(year, month - 1, day);
  }

  function dateLabel(value) {
    const date = parseLocalDate(value);
    if (!date) return "Not planned";
    return new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", year: "numeric" }).format(date);
  }

  function isOverdue(item) {
    return Boolean(item.plannedDate && item.plannedDate < localToday() && item.status !== "posted");
  }

  function isUpcomingDate(value) {
    if (!value) return false;
    const today = parseLocalDate(localToday());
    const candidate = parseLocalDate(value);
    if (!today || !candidate) return false;
    const days = Math.round((candidate - today) / 86400000);
    return days >= 0 && days <= 7;
  }

  function weekBounds() {
    const today = parseLocalDate(localToday());
    const weekday = (today.getDay() + 6) % 7;
    const start = new Date(today);
    start.setDate(today.getDate() - weekday);
    const end = new Date(start);
    end.setDate(start.getDate() + 6);
    const encode = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    return [encode(start), encode(end)];
  }

  function matchesDate(item, filter) {
    const today = localToday();
    switch (filter) {
      case "today": return item.plannedDate === today;
      case "week": {
        const [start, end] = weekBounds();
        return Boolean(item.plannedDate && item.plannedDate >= start && item.plannedDate <= end);
      }
      case "upcoming": return Boolean(item.plannedDate && item.plannedDate > today);
      case "overdue": return isOverdue(item);
      case "none": return !item.plannedDate;
      default: return true;
    }
  }

  function hasActiveFilters() {
    return Boolean(elements.search.value.trim() || elements.platformFilter.value !== "all" ||
      elements.statusFilter.value !== "all" || elements.dateFilter.value !== "all" ||
      elements.sort.value !== "recent" || elements.starredFilter.checked);
  }

  function getVisibleItems() {
    const query = elements.search.value.trim().toLocaleLowerCase();
    const filtered = items.filter((item) =>
      (!query || `${item.title}\n${item.notes}`.toLocaleLowerCase().includes(query)) &&
      (elements.platformFilter.value === "all" || item.platform === elements.platformFilter.value) &&
      (elements.statusFilter.value === "all" || item.status === elements.statusFilter.value) &&
      matchesDate(item, elements.dateFilter.value) &&
      (!elements.starredFilter.checked || item.starred)
    );
    const sort = elements.sort.value;
    const statusRank = (status) => STATUS_ORDER.indexOf(status);
    filtered.sort((a, b) => {
      if (sort === "title") return a.title.localeCompare(b.title, undefined, { sensitivity: "base" });
      if (sort === "soonest") return (a.plannedDate || "9999-12-31").localeCompare(b.plannedDate || "9999-12-31") || a.title.localeCompare(b.title);
      if (sort === "latest") return (b.plannedDate || "").localeCompare(a.plannedDate || "") || a.title.localeCompare(b.title);
      if (sort === "status") return statusRank(a.status) - statusRank(b.status) || a.title.localeCompare(b.title);
      return (Date.parse(b.createdAt) || 0) - (Date.parse(a.createdAt) || 0) || a.title.localeCompare(b.title);
    });
    return filtered;
  }

  function createSvgIcon(platform) {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 16 16");
    svg.setAttribute("aria-hidden", "true");
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    const paths = {
      instagram: "M5 2.5h6A2.5 2.5 0 0 1 13.5 5v6a2.5 2.5 0 0 1-2.5 2.5H5A2.5 2.5 0 0 1 2.5 11V5A2.5 2.5 0 0 1 5 2.5Zm3 2.2A3.3 3.3 0 1 0 8 11.3a3.3 3.3 0 0 0 0-6.6Zm3.5-.3h.01",
      youtube: "M13.3 5.1a1.5 1.5 0 0 0-1.05-1.06C11.3 3.8 8 3.8 8 3.8s-3.3 0-4.25.25A1.5 1.5 0 0 0 2.7 5.1 15.6 15.6 0 0 0 2.45 8c0 .98.08 1.95.25 2.9a1.5 1.5 0 0 0 1.05 1.06c.95.25 4.25.25 4.25.25s3.3 0 4.25-.25a1.5 1.5 0 0 0 1.05-1.06c.17-.95.25-1.92.25-2.9s-.08-1.95-.25-2.9ZM6.7 10V6l3.45 2-3.45 2Z",
      facebook: "M9.3 13V8.7h1.45l.22-1.67H9.3V5.97c0-.48.13-.81.82-.81h.9V3.67c-.44-.05-.9-.08-1.34-.08-1.33 0-2.24.81-2.24 2.3v1.14h-1.5V8.7h1.5V13h1.86Z"
    };
    path.setAttribute("d", paths[platform]);
    svg.append(path);
    return svg;
  }

  function badge(text, className) {
    const node = document.createElement("span");
    node.className = className;
    node.textContent = text;
    return node;
  }

  function renderRow(item) {
    const row = document.createElement("article");
    row.className = "content-row";
    row.dataset.id = item.id;

    const primary = document.createElement("div");
    primary.className = "content-primary";
    const titleWrap = document.createElement("div");
    titleWrap.className = "content-title-wrap";
    const title = document.createElement("div");
    title.className = "content-title";
    const titleText = document.createElement("span");
    titleText.className = "content-title-text";
    titleText.textContent = item.title;
    title.append(titleText);
    if (item.starred) title.append(badge("★", "star-indicator"));
    titleWrap.append(title);
    if (item.notes.trim()) {
      const notes = document.createElement("div");
      notes.className = "notes-preview";
      notes.textContent = item.notes.trim();
      titleWrap.append(notes);
    }
    primary.append(titleWrap);

    const platformCell = document.createElement("div");
    platformCell.className = "row-platform";
    const platformBadge = badge(LABELS.platform[item.platform], `platform-badge platform-${item.platform}`);
    platformBadge.prepend(createSvgIcon(item.platform));
    platformCell.append(platformBadge);

    const dateCell = document.createElement("div");
    dateCell.className = `row-date${item.plannedDate ? "" : " no-date"}`;
    dateCell.textContent = dateLabel(item.plannedDate);
    if (isOverdue(item)) {
      const overdue = badge("Overdue", "overdue-badge");
      overdue.setAttribute("aria-label", `Overdue: planned for ${dateLabel(item.plannedDate)}`);
      dateCell.append(document.createElement("br"), overdue);
    }

    const statusCell = document.createElement("div");
    statusCell.className = "row-status";
    statusCell.append(badge(LABELS.status[item.status], `status-badge status-${item.status}`));

    const actions = document.createElement("div");
    actions.className = "row-actions";
    const trigger = makeButton("⋯", "icon-button row-menu-trigger", () => toggleRowMenu(item.id, trigger));
    trigger.setAttribute("aria-label", `Actions for ${item.title}`);
    trigger.setAttribute("aria-haspopup", "menu");
    trigger.setAttribute("aria-expanded", "false");
    actions.append(trigger);

    row.append(primary, platformCell, dateCell, statusCell, actions);
    return row;
  }

  function renderUpcoming() {
    const allUpcoming = items.filter((item) => item.status !== "posted" && isUpcomingDate(item.plannedDate))
      .sort((a, b) => a.plannedDate.localeCompare(b.plannedDate) || (Date.parse(b.createdAt) || 0) - (Date.parse(a.createdAt) || 0))
    const upcoming = allUpcoming.slice(0, 3);
    elements.upcoming.hidden = upcoming.length === 0;
    elements.upcomingSummary.textContent = `${allUpcoming.length} planned in the next 7 days`;
    elements.upcomingList.replaceChildren();
    for (const item of upcoming) {
      const card = document.createElement("button");
      card.type = "button";
      card.className = "upcoming-item";
      card.dataset.action = "edit-upcoming";
      card.dataset.id = item.id;
      card.setAttribute("aria-label", `Edit ${item.title}, planned ${dateLabel(item.plannedDate)}, ${LABELS.platform[item.platform]}, ${LABELS.status[item.status]}`);
      const title = document.createElement("div");
      title.className = "upcoming-title";
      title.textContent = item.title;
      const meta = document.createElement("div");
      meta.className = "upcoming-meta";
      meta.append(badge(LABELS.platform[item.platform], `platform-badge platform-${item.platform}`));
      const date = document.createElement("span");
      date.className = "upcoming-date";
      const dateValue = document.createElement("span");
      dateValue.textContent = dateLabel(item.plannedDate);
      const dateDistance = Math.round((parseLocalDate(item.plannedDate) - parseLocalDate(localToday())) / 86400000);
      const relativeDate = document.createElement("span");
      relativeDate.className = "upcoming-relative-date";
      relativeDate.textContent = dateDistance === 0 ? "Today" : dateDistance === 1 ? "Tomorrow" : `In ${dateDistance} days`;
      date.append(dateValue, relativeDate);
      const status = badge(LABELS.status[item.status], `status-badge status-${item.status}`);
      status.classList.add("upcoming-status");
      const arrow = document.createElement("span");
      arrow.className = "upcoming-arrow";
      arrow.setAttribute("aria-hidden", "true");
      arrow.textContent = "→";
      card.append(title, date, meta, status, arrow);
      elements.upcomingList.append(card);
    }
  }

  function render() {
    for (const count of elements.counts) {
      const status = count.dataset.count;
      count.textContent = status === "total" ? String(items.length) : String(items.filter((item) => item.status === status).length);
    }
    document.querySelectorAll(".filter-control").forEach((control) => {
      const select = control.querySelector("select");
      const defaultValue = select.id === "sort-select" ? "recent" : "all";
      control.classList.toggle("is-active", select.value !== defaultValue);
    });
    elements.search.parentElement.classList.toggle("is-active", Boolean(elements.search.value.trim()));
    elements.starredFilter.closest(".star-filter").classList.toggle("is-active", elements.starredFilter.checked);
    renderUpcoming();
    const visible = getVisibleItems();
    elements.list.replaceChildren(...visible.map(renderRow));
    elements.empty.hidden = items.length > 0;
    elements.noResults.hidden = !(items.length > 0 && visible.length === 0);
    elements.list.hidden = visible.length === 0;
    const readyCount = visible.filter((item) => item.status === "ready").length;
    elements.results.textContent = hasActiveFilters()
      ? `${visible.length} ${visible.length === 1 ? "idea" : "ideas"} · ${readyCount} ready`
      : `${items.length} ${items.length === 1 ? "idea" : "ideas"} · ${readyCount} ready`;
    elements.clearFilters.hidden = !hasActiveFilters();
    elements.searchClear.hidden = !elements.search.value;
  }

  function makeButton(text, className, handler) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = className;
    button.textContent = text;
    button.addEventListener("click", handler);
    return button;
  }

  function closeRowMenu(restoreFocus = false) {
    if (!openMenu) return;
    const trigger = openMenu.trigger;
    openMenu.element.remove();
    trigger.setAttribute("aria-expanded", "false");
    openMenu = null;
    if (restoreFocus && trigger.isConnected) trigger.focus();
  }

  function toggleRowMenu(id, trigger) {
    if (openMenu && openMenu.id === id) {
      closeRowMenu();
      return;
    }
    closeRowMenu();
    const item = items.find((record) => record.id === id);
    if (!item) return;
    const menu = document.createElement("div");
    menu.className = "row-menu";
    menu.setAttribute("role", "menu");
    const addAction = (icon, label, action, destructive = false) => {
      const button = document.createElement("button");
      button.type = "button";
      button.setAttribute("role", "menuitem");
      if (destructive) button.classList.add("danger-action");
      const iconNode = document.createElement("span");
      iconNode.className = "menu-icon";
      iconNode.setAttribute("aria-hidden", "true");
      iconNode.textContent = icon;
      const text = document.createElement("span");
      text.textContent = label;
      button.append(iconNode, text);
      button.addEventListener("click", () => { closeRowMenu(); action(); });
      menu.append(button);
    };
    addAction("✎", "Edit content", () => openEditor("edit", item));
    addAction("▣", "Duplicate content", () => openEditor("duplicate", item));
    if (item.status === "posted") {
      addAction("↶", "Move back to Ready", () => quickStatus(item.id, "ready"));
    } else {
      const next = STATUS_ORDER[Math.min(STATUS_ORDER.indexOf(item.status) + 1, STATUS_ORDER.length - 1)];
      const label = next === "posted" ? "Mark as Posted" : `Move to ${LABELS.status[next]}`;
      addAction(next === "posted" ? "✓" : "→", label, () => quickStatus(item.id, next));
    }
    menu.append(Object.assign(document.createElement("div"), { className: "menu-divider" }));
    addAction("⌫", "Delete content", () => askDelete(item), true);
    trigger.parentElement.append(menu);
    trigger.setAttribute("aria-expanded", "true");
    openMenu = { id, element: menu, trigger };
    menu.querySelector("button")?.focus();
  }

  function openEditor(mode, item = null) {
    closeRowMenu();
    editorMode = mode;
    editingId = mode === "edit" ? item.id : null;
    elements.editorHeading.textContent = mode === "edit" ? "Edit content" : mode === "duplicate" ? "Duplicate content" : "Add content";
    elements.editorKicker.textContent = mode === "edit" ? "Update your plan" : mode === "duplicate" ? "A fresh copy to work with" : "New idea";
    elements.save.textContent = mode === "edit" ? "Save changes" : mode === "duplicate" ? "Save content" : "Save content";
    elements.editorForm.reset();
    elements.titleError.textContent = "";
    elements.dateError.textContent = "";
    elements.title.removeAttribute("aria-invalid");
    elements.date.removeAttribute("aria-invalid");
    elements.title.closest(".field").classList.remove("is-invalid");
    elements.date.closest(".field").classList.remove("is-invalid");
    if (item) {
      elements.title.value = item.title;
      elements.platform.value = item.platform;
      elements.type.value = item.contentType;
      elements.date.value = item.plannedDate;
      elements.status.value = item.status;
      elements.pillar.value = item.pillar;
      elements.notes.value = item.notes;
      elements.starred.checked = item.starred;
    } else {
      elements.platform.value = "instagram";
      elements.status.value = "idea";
    }
    editorSnapshot = formSnapshot();
    elements.editor.showModal();
    requestAnimationFrame(() => elements.title.focus());
  }

  function formSnapshot() {
    return JSON.stringify({
      title: elements.title.value,
      platform: elements.platform.value,
      type: elements.type.value,
      date: elements.date.value,
      status: elements.status.value,
      pillar: elements.pillar.value,
      notes: elements.notes.value,
      starred: elements.starred.checked
    });
  }

  function closeEditorIfClean() {
    if (formSnapshot() === editorSnapshot) {
      elements.editor.close();
      return;
    }
    showConfirm({
      title: "Discard your changes?",
      copy: "Your unsaved changes will be lost.",
      confirmLabel: "Discard changes",
      destructive: true,
      onConfirm: () => { elements.confirm.close(); elements.editor.close(); }
    });
  }

  function validateForm() {
    const title = elements.title.value.trim();
    if (!title) {
      elements.titleError.textContent = "Enter a title.";
      elements.title.setAttribute("aria-invalid", "true");
      elements.title.closest(".field").classList.add("is-invalid");
      elements.title.focus();
      return false;
    }
    elements.titleError.textContent = "";
    elements.title.removeAttribute("aria-invalid");
    elements.title.closest(".field").classList.remove("is-invalid");
    if (!Object.hasOwn(LABELS.platform, elements.platform.value) || !Object.hasOwn(LABELS.status, elements.status.value)) {
      toast("Choose a valid platform and status.", "error");
      return false;
    }
    if (elements.date.value && !isValidDate(elements.date.value)) {
      elements.dateError.textContent = "Choose a valid planned date.";
      elements.date.setAttribute("aria-invalid", "true");
      elements.date.closest(".field").classList.add("is-invalid");
      elements.date.focus();
      return false;
    }
    elements.dateError.textContent = "";
    elements.date.removeAttribute("aria-invalid");
    elements.date.closest(".field").classList.remove("is-invalid");
    return true;
  }

  function submitForm(event) {
    event.preventDefault();
    if (elements.save.disabled || !validateForm()) return;
    elements.save.disabled = true;
    const now = new Date().toISOString();
    const existing = editorMode === "edit" ? items.find((item) => item.id === editingId) : null;
    const record = {
      id: existing?.id || makeId(),
      title: elements.title.value.trim(),
      platform: elements.platform.value,
      contentType: elements.type.value,
      plannedDate: elements.date.value,
      status: elements.status.value,
      notes: elements.notes.value.trim(),
      pillar: elements.pillar.value,
      starred: elements.starred.checked,
      createdAt: existing?.createdAt || now,
      updatedAt: now
    };
    const next = existing ? items.map((item) => item.id === existing.id ? record : item) : [record, ...items];
    const message = editorMode === "edit" ? "Changes saved." : editorMode === "duplicate" ? "Content duplicated." : "Content added.";
    const saved = persist(next, message);
    elements.save.disabled = false;
    if (saved) {
      elements.editor.close();
      editingId = null;
    }
  }

  function quickStatus(id, status) {
    const item = items.find((record) => record.id === id);
    if (!item) return;
    const next = items.map((record) => record.id === id ? { ...record, status, updatedAt: new Date().toISOString() } : record);
    persist(next, `Moved to ${LABELS.status[status]}.`);
  }

  function showConfirm({ title, copy, confirmLabel, cancelLabel = "Cancel", destructive = false, details = "", onConfirm }) {
    elements.confirmHeading.textContent = title;
    elements.confirmCopy.textContent = copy;
    elements.confirmSymbol.textContent = destructive ? "!" : "✓";
    elements.confirmDetails.textContent = details;
    elements.confirmDetails.hidden = !details;
    elements.confirmActions.replaceChildren();
    elements.confirmActions.append(makeButton(cancelLabel, "button button-secondary", () => elements.confirm.close()));
    const confirmButton = makeButton(confirmLabel, `button ${destructive ? "button-danger" : "button-primary"}`, onConfirm);
    elements.confirmActions.append(confirmButton);
    elements.confirm.showModal();
    requestAnimationFrame(() => confirmButton.focus());
  }

  function askDelete(item) {
    pendingDelete = item;
    showConfirm({
      title: `Delete “${item.title}”?`,
      copy: "You can undo this for a few seconds after deleting.",
      confirmLabel: "Delete",
      destructive: true,
      onConfirm: () => {
        const deleted = items.find((record) => record.id === pendingDelete?.id);
        if (!deleted) { elements.confirm.close(); return; }
        const previous = items;
        const saved = persist(items.filter((record) => record.id !== deleted.id));
        if (saved) {
          lastDeleted = { item: deleted, index: previous.findIndex((record) => record.id === deleted.id) };
          elements.confirm.close();
          toast("Content deleted.", "success", { label: "Undo", action: undoDelete }, 5000);
        }
      }
    });
  }

  function undoDelete() {
    if (!lastDeleted) return;
    const restored = [...items];
    restored.splice(Math.min(lastDeleted.index, restored.length), 0, lastDeleted.item);
    if (persist(restored, "Content restored.")) lastDeleted = null;
  }

  function toast(message, type = "success", action = null, duration = 3000) {
    window.clearTimeout(toastTimer);
    elements.toastRegion.replaceChildren();
    const node = document.createElement("div");
    node.className = "toast";
    const mark = document.createElement("span");
    mark.className = "toast-mark";
    mark.textContent = type === "error" ? "!" : "✓";
    if (type === "error") {
      mark.style.background = "var(--danger-soft)";
      mark.style.color = "var(--danger)";
    }
    const text = document.createElement("span");
    text.className = "toast-message";
    text.textContent = message;
    node.append(mark, text);
    if (action) node.append(makeButton(action.label, "toast-action", () => {
      action.action();
      elements.toastRegion.replaceChildren();
    }));
    elements.toastRegion.append(node);
    if (duration > 0) toastTimer = window.setTimeout(() => node.remove(), duration);
  }

  function clearFilters() {
    elements.search.value = "";
    elements.platformFilter.value = "all";
    elements.statusFilter.value = "all";
    elements.dateFilter.value = "all";
    elements.sort.value = "recent";
    elements.starredFilter.checked = false;
    render();
    toast("Filters cleared.");
  }

  function downloadFile(name, content, mimeType) {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = name;
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function filenameDate() { return localToday(); }

  function exportBackup() {
    const payload = { version: 1, exportedAt: new Date().toISOString(), items };
    downloadFile(`postplan-backup-${filenameDate()}.json`, JSON.stringify(payload, null, 2), "application/json");
    toast("Backup exported.");
  }

  function csvCell(value) {
    const text = String(value ?? "");
    return `"${text.replaceAll('"', '""')}"`;
  }

  function exportCsv() {
    const headers = ["Title", "Platform", "Content type", "Planned date", "Status", "Content pillar", "Notes", "Starred"];
    const rows = items.map((item) => [
      item.title, LABELS.platform[item.platform], LABELS.type[item.contentType] || "", item.plannedDate,
      LABELS.status[item.status], LABELS.pillar[item.pillar] || "", item.notes, item.starred ? "Yes" : "No"
    ]);
    const content = [headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n");
    downloadFile(`postplan-content-${filenameDate()}.csv`, `\uFEFF${content}`, "text/csv;charset=utf-8");
    toast("CSV exported.");
  }

  async function handleRestoreFile(file) {
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text());
      if (!Array.isArray(parsed) && parsed && parsed.version !== 1) throw new Error("This backup version is not supported.");
      const records = Array.isArray(parsed) ? parsed : parsed && Array.isArray(parsed.items) ? parsed.items : null;
      const normalized = normalizeItems(records);
      if (!normalized) throw new Error("The backup structure or one or more content records are invalid, or it contains duplicate IDs.");
      importPayload = normalized;
      showRestoreOptions();
    } catch (error) {
      toast(`Backup could not be restored: ${error.message}`, "error", null, 6000);
    } finally {
      elements.restoreInput.value = "";
    }
  }

  function showRestoreOptions() {
    elements.confirmHeading.textContent = "Restore backup";
    elements.confirmCopy.textContent = `This file contains ${importPayload.length} ${importPayload.length === 1 ? "content idea" : "content ideas"} and looks valid. Choose how to restore it.`;
    elements.confirmSymbol.textContent = "↻";
    elements.confirmDetails.textContent = "Merge keeps current content and adds backup records with new IDs when needed. Replace overwrites your current content and requires a second confirmation.";
    elements.confirmDetails.hidden = false;
    elements.confirmActions.replaceChildren();
    elements.confirmActions.append(makeButton("Cancel", "button button-secondary", () => { importPayload = null; elements.confirm.close(); }));
    elements.confirmActions.append(makeButton("Merge", "button button-primary", mergeBackup));
    const replace = makeButton("Replace", "button button-danger", confirmReplaceBackup);
    elements.confirmActions.append(replace);
    elements.confirm.showModal();
    requestAnimationFrame(() => elements.confirmActions.querySelector("button")?.focus());
  }

  function mergeBackup() {
    if (!importPayload) return;
    const currentIds = new Set(items.map((item) => item.id));
    const additions = importPayload.map((item) => {
      if (!currentIds.has(item.id)) { currentIds.add(item.id); return item; }
      return { ...item, id: makeId() };
    });
    const merged = [...additions, ...items];
    if (persist(merged, `Backup merged · ${additions.length} ${additions.length === 1 ? "idea" : "ideas"} added.`)) {
      importPayload = null;
      elements.confirm.close();
    }
  }

  function confirmReplaceBackup() {
    const payload = importPayload;
    elements.confirm.close();
    showConfirm({
      title: "Replace all current content?",
      copy: `This will replace ${items.length} current ${items.length === 1 ? "idea" : "ideas"} with ${payload.length} backup ${payload.length === 1 ? "idea" : "ideas"}. This cannot be undone.`,
      confirmLabel: "Replace content",
      destructive: true,
      onConfirm: () => {
        if (persist(payload, "Backup restored.")) {
          importPayload = null;
          elements.confirm.close();
        }
      }
    });
  }

  function handleGlobalClick(event) {
    if (openMenu && !openMenu.element.contains(event.target) && !openMenu.trigger.contains(event.target)) closeRowMenu();
  }

  function handleKeydown(event) {
    if (event.key === "Escape") {
      if (elements.confirm.open) {
        event.preventDefault();
        elements.confirm.close();
        return;
      }
      if (openMenu) { closeRowMenu(true); event.stopPropagation(); return; }
      if (elements.editor.open) { event.preventDefault(); closeEditorIfClean(); return; }
    }
    const target = event.target;
    const isTyping = target instanceof HTMLElement &&
      (target.matches("input, textarea, select, [contenteditable='true']") || Boolean(target.closest("dialog")));
    if (event.key === "/" && !isTyping) {
      event.preventDefault();
      elements.search.focus();
    } else if (event.key.toLowerCase() === "n" && !event.metaKey && !event.ctrlKey && !event.altKey && !isTyping) {
      event.preventDefault();
      openEditor("add");
    }
  }

  function installEvents() {
    elements.editorForm.addEventListener("submit", submitForm);
    elements.title.addEventListener("input", () => {
      if (!elements.title.value.trim()) return;
      elements.titleError.textContent = "";
      elements.title.removeAttribute("aria-invalid");
      elements.title.closest(".field").classList.remove("is-invalid");
    });
    elements.date.addEventListener("change", () => {
      if (elements.date.value && !isValidDate(elements.date.value)) return;
      elements.dateError.textContent = "";
      elements.date.removeAttribute("aria-invalid");
      elements.date.closest(".field").classList.remove("is-invalid");
    });
    elements.editor.addEventListener("cancel", (event) => { event.preventDefault(); closeEditorIfClean(); });
    elements.editor.addEventListener("click", (event) => {
      if (event.target === elements.editor) closeEditorIfClean();
    });
    elements.confirm.addEventListener("cancel", (event) => event.preventDefault());
    elements.search.addEventListener("input", render);
    elements.search.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && elements.search.value) {
        event.stopPropagation();
        elements.search.value = "";
        render();
      }
    });
    elements.searchClear.addEventListener("click", () => { elements.search.value = ""; render(); elements.search.focus(); });
    [elements.platformFilter, elements.statusFilter, elements.dateFilter, elements.sort, elements.starredFilter].forEach((input) => input.addEventListener("change", render));
    elements.clearFilters.addEventListener("click", clearFilters);
    elements.restoreInput.addEventListener("change", () => handleRestoreFile(elements.restoreInput.files[0]));
    document.addEventListener("click", handleGlobalClick);
    document.addEventListener("keydown", handleKeydown);
    document.addEventListener("click", (event) => {
      const action = event.target.closest("[data-action]");
      if (!action) return;
      const name = action.dataset.action;
      if (name === "add") openEditor("add");
      if (name === "request-close") closeEditorIfClean();
      if (name === "clear-filters") clearFilters();
      if (name === "edit-upcoming") {
        const item = items.find((record) => record.id === action.dataset.id);
        if (item) openEditor("edit", item);
      }
      if (name === "view-upcoming") {
        elements.dateFilter.value = "upcoming";
        render();
        document.querySelector(".toolbar").scrollIntoView({ behavior: "smooth", block: "center" });
      }
    });
  }

  function init() {
    items = readStoredData();
    installEvents();
    render();
  }

  init();
})();
