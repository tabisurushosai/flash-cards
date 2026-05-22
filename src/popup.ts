type Card = {
  front: string;
  back: string;
  stats?: CardStats;
};

type CardStats = {
  done: number;
  again: number;
};

type Deck = {
  id: string;
  name: string;
  cards: Card[];
};

type View =
  | { name: "decks" }
  | { name: "cards"; deckId: string }
  | { name: "study"; deckId: string; reviewQueue: number[]; isBackVisible: boolean };

type StoredState = {
  decks: Deck[];
  view: View;
  premium?: PremiumState;
};

type PremiumState = {
  trialStartedAt?: string;
  purchasedAt?: string;
};

const STORAGE_KEY = "flashCardsState";
const FREE_DECK_LIMIT = 2;
const TRIAL_DURATION_MS = 7 * 24 * 60 * 60 * 1000;
const STRIPE_CHECKOUT_URL = "https://checkout.stripe.com/c/pay/cs_test_flash_cards_premium";

type MessageSubstitution = string | string[];

const t = (key: string, substitutions?: MessageSubstitution): string => {
  const message = chrome.i18n.getMessage(key, substitutions);
  return message || key;
};

const defaultDecks: Deck[] = [
  {
    id: "sample-basic",
    name: t("sampleBasicDeckName"),
    cards: [
      { front: t("sampleHelloFront"), back: t("sampleHelloBack") },
      { front: t("sampleMorningFront"), back: t("sampleMorningBack") },
    ],
  },
  {
    id: "sample-review",
    name: t("sampleReviewDeckName"),
    cards: [{ front: t("sampleThanksFront"), back: t("sampleThanksBack") }],
  },
];

let decks: Deck[] = [];
let view: View = { name: "decks" };
let premium: PremiumState = {};

const app = document.querySelector<HTMLDivElement>("#app");
const title = document.querySelector("title");
const appTitle = document.querySelector<HTMLHeadingElement>("#app-title");

if (!app) {
  throw new Error("App root was not found.");
}

if (title) {
  title.textContent = t("extName");
}

if (appTitle) {
  appTitle.textContent = t("extName");
}

const createId = (): string => {
  if (crypto.randomUUID) {
    return crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
};

const escapeHtml = (value: string): string =>
  value.replace(/[&<>"']/g, (character) => {
    const entities: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };

    return entities[character];
  });

const isCard = (value: unknown): value is Card => {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Card;
  return (
    typeof candidate.front === "string" &&
    typeof candidate.back === "string" &&
    (candidate.stats === undefined ||
      (typeof candidate.stats === "object" &&
        Number.isInteger(candidate.stats.done) &&
        candidate.stats.done >= 0 &&
        Number.isInteger(candidate.stats.again) &&
        candidate.stats.again >= 0))
  );
};

const isDeck = (value: unknown): value is Deck => {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Deck;
  return (
    typeof candidate.id === "string" &&
    typeof candidate.name === "string" &&
    Array.isArray(candidate.cards) &&
    candidate.cards.every(isCard)
  );
};

const deckExists = (decksToSearch: Deck[], deckId: string): boolean =>
  decksToSearch.some((deck) => deck.id === deckId);

const isValidReviewQueue = (deck: Deck, value: unknown): value is number[] =>
  Array.isArray(value) &&
  value.length > 0 &&
  value.every(
    (cardIndex) =>
      Number.isInteger(cardIndex) && cardIndex >= 0 && cardIndex < deck.cards.length,
  );

const isViewForDecks = (value: unknown, decksToSearch: Deck[]): value is View => {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as View;

  if (candidate.name === "decks") {
    return true;
  }

  if (candidate.name === "cards") {
    return typeof candidate.deckId === "string" && deckExists(decksToSearch, candidate.deckId);
  }

  if (candidate.name !== "study" || typeof candidate.deckId !== "string") {
    return false;
  }

  const deck = decksToSearch.find((deckToSearch) => deckToSearch.id === candidate.deckId);

  return (
    !!deck &&
    deck.cards.length > 0 &&
    isValidReviewQueue(deck, candidate.reviewQueue) &&
    typeof candidate.isBackVisible === "boolean"
  );
};

const isPremiumState = (value: unknown): value is PremiumState => {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as PremiumState;
  return (
    (candidate.trialStartedAt === undefined || typeof candidate.trialStartedAt === "string") &&
    (candidate.purchasedAt === undefined || typeof candidate.purchasedAt === "string")
  );
};

const isTrialActive = (): boolean => {
  if (!premium.trialStartedAt) {
    return false;
  }

  const trialStartedAt = Date.parse(premium.trialStartedAt);
  return Number.isFinite(trialStartedAt) && Date.now() - trialStartedAt < TRIAL_DURATION_MS;
};

const isPremiumActive = (): boolean => !!premium.purchasedAt || isTrialActive();

const getTrialDaysLeft = (): number => {
  if (!premium.trialStartedAt) {
    return 0;
  }

  const trialStartedAt = Date.parse(premium.trialStartedAt);

  if (!Number.isFinite(trialStartedAt)) {
    return 0;
  }

  return Math.max(0, Math.ceil((TRIAL_DURATION_MS - (Date.now() - trialStartedAt)) / 86400000));
};

const getAccuracy = (deck: Deck): number | null => {
  const totals = deck.cards.reduce(
    (result, card) => ({
      done: result.done + (card.stats?.done ?? 0),
      attempts: result.attempts + (card.stats?.done ?? 0) + (card.stats?.again ?? 0),
    }),
    { done: 0, attempts: 0 },
  );

  if (totals.attempts === 0) {
    return null;
  }

  return Math.round((totals.done / totals.attempts) * 100);
};

const shuffleQueue = (queue: number[]): number[] => {
  const shuffledQueue = [...queue];

  for (let index = shuffledQueue.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [shuffledQueue[index], shuffledQueue[swapIndex]] = [shuffledQueue[swapIndex], shuffledQueue[index]];
  }

  return shuffledQueue;
};

const loadStoredState = async (): Promise<StoredState | null> => {
  const result = await chrome.storage.local.get(STORAGE_KEY);
  const storedState = result[STORAGE_KEY];

  if (!storedState || typeof storedState !== "object") {
    return null;
  }

  const candidate = storedState as StoredState;

  if (!Array.isArray(candidate.decks) || !candidate.decks.every(isDeck)) {
    return null;
  }

  return {
    decks: candidate.decks,
    view: isViewForDecks(candidate.view, candidate.decks) ? candidate.view : { name: "decks" },
    premium: isPremiumState(candidate.premium) ? candidate.premium : {},
  };
};

const saveState = async (): Promise<void> => {
  await chrome.storage.local.set({ [STORAGE_KEY]: { decks, view, premium } satisfies StoredState });
};

const loadState = async (): Promise<void> => {
  const storedState = await loadStoredState();
  decks = storedState?.decks ?? defaultDecks;
  view = storedState?.view ?? { name: "decks" };
  premium = storedState?.premium ?? {};

  if (!storedState) {
    await saveState();
  }
};

const setView = (nextView: View): void => {
  view = nextView;
  render();
  void saveState();
};

const getDeck = (deckId: string): Deck => {
  const deck = decks.find((candidate) => candidate.id === deckId);

  if (!deck) {
    throw new Error(`Deck was not found: ${deckId}`);
  }

  return deck;
};

const createReviewQueue = (deckId: string): number[] => getDeck(deckId).cards.map((_, index) => index);

const advanceReviewQueue = (reviewQueue: number[], shouldPrioritizeCurrent: boolean): number[] => {
  const [currentCardIndex, ...remainingQueue] = reviewQueue;

  if (currentCardIndex === undefined) {
    return reviewQueue;
  }

  if (remainingQueue.length === 0) {
    return [currentCardIndex];
  }

  if (shouldPrioritizeCurrent) {
    const [nextCardIndex, ...laterQueue] = remainingQueue;
    return [nextCardIndex, currentCardIndex, ...laterQueue];
  }

  return [...remainingQueue, currentCardIndex];
};

const createDeck = async (): Promise<void> => {
  if (!isPremiumActive() && decks.length >= FREE_DECK_LIMIT) {
    window.alert(t("freeDeckLimitMessage"));
    return;
  }

  decks = [
    ...decks,
    {
      id: createId(),
      name: t("newDeckName", String(decks.length + 1)),
      cards: [],
    },
  ];
  await saveState();
  setView({ name: "decks" });
};

const startTrial = async (): Promise<void> => {
  if (!premium.trialStartedAt) {
    premium = { ...premium, trialStartedAt: new Date().toISOString() };
    await saveState();
  }

  setView({ name: "decks" });
};

const openCheckout = async (): Promise<void> => {
  window.open(STRIPE_CHECKOUT_URL, "_blank", "noopener,noreferrer");

  if (window.confirm(t("checkoutCompleteConfirm"))) {
    premium = { ...premium, purchasedAt: new Date().toISOString() };
    await saveState();
    setView({ name: "decks" });
  }
};

const renameDeck = async (deckId: string): Promise<void> => {
  const deck = getDeck(deckId);
  const name = window.prompt(t("deckNamePrompt"), deck.name)?.trim();

  if (!name) {
    return;
  }

  decks = decks.map((candidate) => (candidate.id === deckId ? { ...candidate, name } : candidate));
  await saveState();
  setView({ name: "decks" });
};

const deleteDeck = async (deckId: string): Promise<void> => {
  const deck = getDeck(deckId);

  if (!window.confirm(t("deleteDeckConfirm", deck.name))) {
    return;
  }

  decks = decks.filter((candidate) => candidate.id !== deckId);
  await saveState();
  setView({ name: "decks" });
};

const addCard = async (deckId: string): Promise<void> => {
  const front = window.prompt(t("frontPrompt"))?.trim();

  if (!front) {
    return;
  }

  const back = window.prompt(t("backPrompt"))?.trim();

  if (!back) {
    return;
  }

  decks = decks.map((deck) =>
    deck.id === deckId ? { ...deck, cards: [...deck.cards, { front, back }] } : deck,
  );
  await saveState();
  setView({ name: "cards", deckId });
};

const editCard = async (deckId: string, cardIndex: number): Promise<void> => {
  const deck = getDeck(deckId);
  const card = deck.cards[cardIndex];

  if (!card) {
    return;
  }

  const front = window.prompt(t("frontPrompt"), card.front)?.trim();

  if (!front) {
    return;
  }

  const back = window.prompt(t("backPrompt"), card.back)?.trim();

  if (!back) {
    return;
  }

  decks = decks.map((candidate) => {
    if (candidate.id !== deckId) {
      return candidate;
    }

    return {
      ...candidate,
      cards: candidate.cards.map((candidateCard, index) =>
        index === cardIndex ? { front, back } : candidateCard,
      ),
    };
  });
  await saveState();
  setView({ name: "cards", deckId });
};

const deleteCard = async (deckId: string, cardIndex: number): Promise<void> => {
  const deck = getDeck(deckId);
  const card = deck.cards[cardIndex];

  if (!card || !window.confirm(t("deleteCardConfirm", card.front))) {
    return;
  }

  decks = decks.map((candidate) =>
    candidate.id === deckId
      ? { ...candidate, cards: candidate.cards.filter((_, index) => index !== cardIndex) }
      : candidate,
  );
  await saveState();
  setView({ name: "cards", deckId });
};

const moveCard = async (deckId: string, cardIndex: number, direction: -1 | 1): Promise<void> => {
  const deck = getDeck(deckId);
  const nextIndex = cardIndex + direction;

  if (nextIndex < 0 || nextIndex >= deck.cards.length) {
    return;
  }

  const cards = [...deck.cards];
  const [card] = cards.splice(cardIndex, 1);
  cards.splice(nextIndex, 0, card);

  decks = decks.map((candidate) => (candidate.id === deckId ? { ...candidate, cards } : candidate));
  await saveState();
  setView({ name: "cards", deckId });
};

const recordAnswer = async (deckId: string, cardIndex: number, result: keyof CardStats): Promise<void> => {
  decks = decks.map((candidate) => {
    if (candidate.id !== deckId) {
      return candidate;
    }

    return {
      ...candidate,
      cards: candidate.cards.map((card, index) => {
        if (index !== cardIndex) {
          return card;
        }

        const stats = card.stats ?? { done: 0, again: 0 };
        return { ...card, stats: { ...stats, [result]: stats[result] + 1 } };
      }),
    };
  });
  await saveState();
};

const renderPremiumPanel = (): string => {
  const active = isPremiumActive();
  const trialDaysLeft = getTrialDaysLeft();
  const status = premium.purchasedAt
    ? t("premiumPurchasedStatus")
    : active
      ? t("trialActiveStatus", String(trialDaysLeft))
      : premium.trialStartedAt
        ? t("trialExpiredStatus")
        : t("freePlanStatus", String(FREE_DECK_LIMIT));

  return `
    <section class="premium-panel" aria-label="${escapeHtml(t("premiumTitle"))}">
      <div>
        <h3>${t("premiumTitle")}</h3>
        <p>${status}</p>
      </div>
      <div class="premium-actions">
        ${
          premium.trialStartedAt || premium.purchasedAt
            ? ""
            : `<button type="button" data-start-trial>${t("startTrialButton")}</button>`
        }
        ${premium.purchasedAt ? "" : `<button type="button" data-open-checkout>${t("checkoutButton")}</button>`}
      </div>
    </section>
  `;
};

const renderDeckList = (): string => `
  <section class="deck-list" aria-labelledby="deck-list-title">
    ${renderPremiumPanel()}
    <div class="toolbar">
      <div>
        <h2 id="deck-list-title">${t("decksTitle")}</h2>
        <p>${t("deckCount", String(decks.length))}</p>
      </div>
      <button type="button" class="primary-button" data-create-deck ${
        !isPremiumActive() && decks.length >= FREE_DECK_LIMIT ? "disabled" : ""
      }>${t("addButton")}</button>
    </div>
    <div class="deck-items">
      ${decks
        .map(
          (deck) => `
            <article class="deck-item">
              <div>
                <h3>${escapeHtml(deck.name)}</h3>
                <p>${t("cardCount", String(deck.cards.length))}</p>
                ${
                  isPremiumActive()
                    ? `<p>${t("accuracyLabel", getAccuracy(deck) === null ? t("accuracyNoData") : String(getAccuracy(deck)))}</p>`
                    : ""
                }
              </div>
              <div class="deck-actions">
                <button type="button" data-rename-deck-id="${escapeHtml(deck.id)}">${t("editButton")}</button>
                <button type="button" data-delete-deck-id="${escapeHtml(deck.id)}">${t("deleteButton")}</button>
                <button type="button" data-manage-cards-deck-id="${escapeHtml(deck.id)}">${t("cardsButton")}</button>
                <button type="button" data-study-deck-id="${escapeHtml(deck.id)}" ${deck.cards.length === 0 ? "disabled" : ""}>${t("studyButton")}</button>
                ${
                  isPremiumActive()
                    ? `<button type="button" data-shuffle-study-deck-id="${escapeHtml(deck.id)}" ${
                        deck.cards.length === 0 ? "disabled" : ""
                      }>${t("shuffleButton")}</button>`
                    : ""
                }
              </div>
            </article>
          `,
        )
        .join("")}
    </div>
  </section>
`;

const renderCardEditor = (deckId: string): string => {
  const deck = getDeck(deckId);

  return `
    <section class="card-editor" aria-labelledby="card-editor-title">
      <div class="toolbar">
        <button type="button" data-back-to-decks>${t("backButton")}</button>
        <div>
          <h2 id="card-editor-title">${escapeHtml(deck.name)}</h2>
          <p>${t("cardCount", String(deck.cards.length))}</p>
        </div>
        <button type="button" class="primary-button" data-add-card>${t("addButton")}</button>
      </div>
      <div class="card-items">
        ${
          deck.cards.length === 0
            ? `<p class="empty-message">${t("emptyCards")}</p>`
            : deck.cards
                .map(
                  (card, index) => `
                    <article class="card-item">
                      <div class="card-text">
                        <p class="card-label">${t("frontLabel")}</p>
                        <h3>${escapeHtml(card.front)}</h3>
                        <p class="card-label">${t("backLabel")}</p>
                        <p>${escapeHtml(card.back)}</p>
                      </div>
                      <div class="card-actions">
                        <button type="button" data-move-card-up="${index}" ${index === 0 ? "disabled" : ""}>${t("moveUpButton")}</button>
                        <button type="button" data-move-card-down="${index}" ${
                          index === deck.cards.length - 1 ? "disabled" : ""
                        }>${t("moveDownButton")}</button>
                        <button type="button" data-edit-card-index="${index}">${t("editButton")}</button>
                        <button type="button" data-delete-card-index="${index}">${t("deleteButton")}</button>
                      </div>
                    </article>
                  `,
                )
                .join("")
        }
      </div>
    </section>
  `;
};

const renderStudy = (deckId: string, reviewQueue: number[], isBackVisible: boolean): string => {
  const deck = getDeck(deckId);
  const cardIndex = reviewQueue[0] ?? 0;
  const card = deck.cards[cardIndex];
  const progress = t("studyProgress", [String(cardIndex + 1), String(deck.cards.length)]);
  const sideLabel = isBackVisible ? t("backLabel") : t("frontLabel");
  const flipLabel = isBackVisible ? t("showFrontButton") : t("showBackButton");

  return `
    <section class="study-view" aria-labelledby="study-title">
      <div class="study-header">
        <button type="button" data-back-to-decks>${t("backButton")}</button>
        <div>
          <h2 id="study-title">${escapeHtml(deck.name)}</h2>
          <p>${progress}</p>
        </div>
      </div>
      <button type="button" class="flash-card" data-flip-card aria-label="${escapeHtml(t("flipCardAria"))}">
        <small>${sideLabel}</small>
        <span>${escapeHtml(isBackVisible ? card.back : card.front)}</span>
      </button>
      <button type="button" data-flip-card>${flipLabel}</button>
      <div class="answer-actions">
        <button type="button" data-mark-again ${isBackVisible ? "" : "disabled"}>${t("againButton")}</button>
        <button type="button" class="primary-button" data-mark-done ${
          isBackVisible ? "" : "disabled"
        }>${t("doneButton")}</button>
      </div>
    </section>
  `;
};

const bindDeckList = (): void => {
  app.querySelector<HTMLButtonElement>("[data-start-trial]")?.addEventListener("click", () => {
    void startTrial();
  });

  app.querySelector<HTMLButtonElement>("[data-open-checkout]")?.addEventListener("click", () => {
    void openCheckout();
  });

  app.querySelector<HTMLButtonElement>("[data-create-deck]")?.addEventListener("click", () => {
    void createDeck();
  });

  app.querySelectorAll<HTMLButtonElement>("[data-rename-deck-id]").forEach((button) => {
    button.addEventListener("click", () => {
      const deckId = button.dataset.renameDeckId;

      if (deckId) {
        void renameDeck(deckId);
      }
    });
  });

  app.querySelectorAll<HTMLButtonElement>("[data-delete-deck-id]").forEach((button) => {
    button.addEventListener("click", () => {
      const deckId = button.dataset.deleteDeckId;

      if (deckId) {
        void deleteDeck(deckId);
      }
    });
  });

  app.querySelectorAll<HTMLButtonElement>("[data-study-deck-id]").forEach((button) => {
    button.addEventListener("click", () => {
      const deckId = button.dataset.studyDeckId;

      if (deckId) {
        setView({ name: "study", deckId, reviewQueue: createReviewQueue(deckId), isBackVisible: false });
      }
    });
  });

  app.querySelectorAll<HTMLButtonElement>("[data-shuffle-study-deck-id]").forEach((button) => {
    button.addEventListener("click", () => {
      const deckId = button.dataset.shuffleStudyDeckId;

      if (deckId) {
        setView({
          name: "study",
          deckId,
          reviewQueue: shuffleQueue(createReviewQueue(deckId)),
          isBackVisible: false,
        });
      }
    });
  });

  app.querySelectorAll<HTMLButtonElement>("[data-manage-cards-deck-id]").forEach((button) => {
    button.addEventListener("click", () => {
      const deckId = button.dataset.manageCardsDeckId;

      if (deckId) {
        setView({ name: "cards", deckId });
      }
    });
  });
};

const bindCardEditor = (deckId: string): void => {
  app.querySelector<HTMLButtonElement>("[data-back-to-decks]")?.addEventListener("click", () => {
    setView({ name: "decks" });
  });

  app.querySelector<HTMLButtonElement>("[data-add-card]")?.addEventListener("click", () => {
    void addCard(deckId);
  });

  app.querySelectorAll<HTMLButtonElement>("[data-edit-card-index]").forEach((button) => {
    button.addEventListener("click", () => {
      const cardIndex = Number(button.dataset.editCardIndex);

      if (Number.isInteger(cardIndex)) {
        void editCard(deckId, cardIndex);
      }
    });
  });

  app.querySelectorAll<HTMLButtonElement>("[data-delete-card-index]").forEach((button) => {
    button.addEventListener("click", () => {
      const cardIndex = Number(button.dataset.deleteCardIndex);

      if (Number.isInteger(cardIndex)) {
        void deleteCard(deckId, cardIndex);
      }
    });
  });

  app.querySelectorAll<HTMLButtonElement>("[data-move-card-up]").forEach((button) => {
    button.addEventListener("click", () => {
      const cardIndex = Number(button.dataset.moveCardUp);

      if (Number.isInteger(cardIndex)) {
        void moveCard(deckId, cardIndex, -1);
      }
    });
  });

  app.querySelectorAll<HTMLButtonElement>("[data-move-card-down]").forEach((button) => {
    button.addEventListener("click", () => {
      const cardIndex = Number(button.dataset.moveCardDown);

      if (Number.isInteger(cardIndex)) {
        void moveCard(deckId, cardIndex, 1);
      }
    });
  });
};

const bindStudy = (deckId: string, reviewQueue: number[], isBackVisible: boolean): void => {
  app.querySelector<HTMLButtonElement>("[data-back-to-decks]")?.addEventListener("click", () => {
    setView({ name: "decks" });
  });

  app.querySelectorAll<HTMLButtonElement>("[data-flip-card]").forEach((button) => {
    button.addEventListener("click", () => {
      setView({ name: "study", deckId, reviewQueue, isBackVisible: !isBackVisible });
    });
  });

  app.querySelector<HTMLButtonElement>("[data-mark-again]")?.addEventListener("click", () => {
    if (!isBackVisible) {
      return;
    }

    const cardIndex = reviewQueue[0];

    if (cardIndex !== undefined) {
      void recordAnswer(deckId, cardIndex, "again").then(() => {
        setView({
          name: "study",
          deckId,
          reviewQueue: advanceReviewQueue(reviewQueue, true),
          isBackVisible: false,
        });
      });
    }
  });

  app.querySelector<HTMLButtonElement>("[data-mark-done]")?.addEventListener("click", () => {
    if (!isBackVisible) {
      return;
    }

    const cardIndex = reviewQueue[0];

    if (cardIndex !== undefined) {
      void recordAnswer(deckId, cardIndex, "done").then(() => {
        setView({
          name: "study",
          deckId,
          reviewQueue: advanceReviewQueue(reviewQueue, false),
          isBackVisible: false,
        });
      });
    }
  });
};

const render = (): void => {
  if (view.name === "decks") {
    app.innerHTML = renderDeckList();
    bindDeckList();
    return;
  }

  if (view.name === "cards") {
    app.innerHTML = renderCardEditor(view.deckId);
    bindCardEditor(view.deckId);
    return;
  }

  app.innerHTML = renderStudy(view.deckId, view.reviewQueue, view.isBackVisible);
  bindStudy(view.deckId, view.reviewQueue, view.isBackVisible);
};

const style = document.createElement("style");
style.textContent = `
  :root {
    color: #1f2937;
    background: #f8fafc;
  }

  body {
    margin: 0;
    color: #1f2937;
    background: #f8fafc;
  }

  button {
    min-height: 34px;
    border: 1px solid #cbd5e1;
    border-radius: 6px;
    padding: 7px 10px;
    color: #1f2937;
    background: #ffffff;
    font: inherit;
    cursor: pointer;
  }

  button:disabled {
    color: #94a3b8;
    cursor: not-allowed;
  }

  h2,
  h3,
  p {
    margin: 0;
  }

  h2 {
    font-size: 18px;
    line-height: 1.3;
  }

  h3 {
    font-size: 14px;
    line-height: 1.4;
  }

  p {
    margin-top: 2px;
    color: #64748b;
    font-size: 12px;
  }

  .primary-button {
    border-color: #2563eb;
    color: #ffffff;
    background: #2563eb;
  }

  .deck-list,
  .card-editor,
  .study-view {
    display: grid;
    gap: 12px;
  }

  .premium-panel {
    display: grid;
    gap: 8px;
    border: 1px solid #e2e8f0;
    border-radius: 8px;
    padding: 10px;
    background: #ffffff;
  }

  .premium-actions {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(0, 1fr));
    gap: 6px;
  }

  .premium-actions button {
    min-width: 0;
    padding-right: 6px;
    padding-left: 6px;
    font-size: 12px;
  }

  .toolbar,
  .study-header,
  .answer-actions {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
  }

  .deck-items {
    display: grid;
    gap: 8px;
  }

  .card-items {
    display: grid;
    gap: 8px;
  }

  .deck-item {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: center;
    gap: 10px;
    border: 1px solid #e2e8f0;
    border-radius: 8px;
    padding: 10px;
    background: #ffffff;
  }

  .card-item {
    display: grid;
    gap: 8px;
    border: 1px solid #e2e8f0;
    border-radius: 8px;
    padding: 10px;
    background: #ffffff;
  }

  .card-text {
    display: grid;
    gap: 3px;
  }

  .card-label {
    margin-top: 0;
    font-weight: 700;
  }

  .deck-actions {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 6px;
  }

  .card-actions {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 6px;
  }

  .empty-message {
    border: 1px dashed #cbd5e1;
    border-radius: 8px;
    padding: 14px;
    text-align: center;
    background: #ffffff;
  }

  .flash-card {
    display: grid;
    place-items: center;
    gap: 8px;
    width: 100%;
    min-height: 148px;
    border-color: #94a3b8;
    padding: 16px;
    text-align: center;
    background: #ffffff;
  }

  .flash-card small {
    color: #64748b;
    font-size: 12px;
    font-weight: 700;
  }

  .flash-card span {
    font-size: 18px;
    font-weight: 700;
    line-height: 1.5;
  }

  .answer-actions button {
    flex: 1;
  }
`;
document.head.append(style);

void loadState()
  .then(() => {
    render();
  })
  .catch((error: unknown) => {
    app.textContent = t("loadError");
    console.error(error);
  });
