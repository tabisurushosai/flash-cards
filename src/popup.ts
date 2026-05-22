type Card = {
  front: string;
  back: string;
};

type Deck = {
  id: string;
  name: string;
  cards: Card[];
};

type View =
  | { name: "decks" }
  | { name: "study"; deckId: string; cardIndex: number; isBackVisible: boolean };

const decks: Deck[] = [
  {
    id: "sample-basic",
    name: "基本カード",
    cards: [
      { front: "表: Hello", back: "裏: こんにちは" },
      { front: "表: Good morning", back: "裏: おはよう" },
    ],
  },
  {
    id: "sample-review",
    name: "復習カード",
    cards: [{ front: "表: Thank you", back: "裏: ありがとう" }],
  },
];

let view: View = { name: "decks" };

const app = document.querySelector<HTMLDivElement>("#app");

if (!app) {
  throw new Error("App root was not found.");
}

const setView = (nextView: View): void => {
  view = nextView;
  render();
};

const getDeck = (deckId: string): Deck => {
  const deck = decks.find((candidate) => candidate.id === deckId);

  if (!deck) {
    throw new Error(`Deck was not found: ${deckId}`);
  }

  return deck;
};

const renderDeckList = (): string => `
  <section class="deck-list" aria-labelledby="deck-list-title">
    <div class="toolbar">
      <div>
        <h2 id="deck-list-title">デッキ</h2>
        <p>${decks.length}件</p>
      </div>
      <button type="button" class="primary-button" disabled>追加</button>
    </div>
    <div class="deck-items">
      ${decks
        .map(
          (deck) => `
            <article class="deck-item">
              <div>
                <h3>${deck.name}</h3>
                <p>${deck.cards.length}枚のカード</p>
              </div>
              <button type="button" data-study-deck-id="${deck.id}">学習</button>
            </article>
          `,
        )
        .join("")}
    </div>
  </section>
`;

const renderStudy = (deckId: string, cardIndex: number, isBackVisible: boolean): string => {
  const deck = getDeck(deckId);
  const card = deck.cards[cardIndex];
  const progress = `${cardIndex + 1} / ${deck.cards.length}`;

  return `
    <section class="study-view" aria-labelledby="study-title">
      <div class="study-header">
        <button type="button" data-back-to-decks>戻る</button>
        <div>
          <h2 id="study-title">${deck.name}</h2>
          <p>${progress}</p>
        </div>
      </div>
      <button type="button" class="flash-card" data-flip-card aria-label="カードをめくる">
        <span>${isBackVisible ? card.back : card.front}</span>
      </button>
      <div class="answer-actions">
        <button type="button" data-mark-again>まだ</button>
        <button type="button" class="primary-button" data-mark-done>できた</button>
      </div>
    </section>
  `;
};

const bindDeckList = (): void => {
  app.querySelectorAll<HTMLButtonElement>("[data-study-deck-id]").forEach((button) => {
    button.addEventListener("click", () => {
      const deckId = button.dataset.studyDeckId;

      if (deckId) {
        setView({ name: "study", deckId, cardIndex: 0, isBackVisible: false });
      }
    });
  });
};

const bindStudy = (deckId: string, cardIndex: number, isBackVisible: boolean): void => {
  const deck = getDeck(deckId);
  const nextCardIndex = (cardIndex + 1) % deck.cards.length;

  app.querySelector<HTMLButtonElement>("[data-back-to-decks]")?.addEventListener("click", () => {
    setView({ name: "decks" });
  });

  app.querySelector<HTMLButtonElement>("[data-flip-card]")?.addEventListener("click", () => {
    setView({ name: "study", deckId, cardIndex, isBackVisible: !isBackVisible });
  });

  app.querySelector<HTMLButtonElement>("[data-mark-again]")?.addEventListener("click", () => {
    setView({ name: "study", deckId, cardIndex: nextCardIndex, isBackVisible: false });
  });

  app.querySelector<HTMLButtonElement>("[data-mark-done]")?.addEventListener("click", () => {
    setView({ name: "study", deckId, cardIndex: nextCardIndex, isBackVisible: false });
  });
};

const render = (): void => {
  app.innerHTML = view.name === "decks" ? renderDeckList() : renderStudy(view.deckId, view.cardIndex, view.isBackVisible);

  if (view.name === "decks") {
    bindDeckList();
    return;
  }

  bindStudy(view.deckId, view.cardIndex, view.isBackVisible);
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
  .study-view {
    display: grid;
    gap: 12px;
  }

  .toolbar,
  .study-header,
  .deck-item,
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

  .deck-item {
    border: 1px solid #e2e8f0;
    border-radius: 8px;
    padding: 10px;
    background: #ffffff;
  }

  .flash-card {
    display: grid;
    place-items: center;
    width: 100%;
    min-height: 148px;
    border-color: #94a3b8;
    padding: 16px;
    text-align: center;
    background: #ffffff;
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

render();
