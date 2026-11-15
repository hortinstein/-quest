let pendingCatalog;

export function loadQuestCatalog() {
  pendingCatalog ??= fetch('data/quest-catalog.json', { cache: 'no-cache' })
    .then(async (response) => {
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const quests = await response.json();
      if (!Array.isArray(quests) || !quests.length) throw new Error('Empty quest catalog');
      return quests;
    })
    .catch((error) => {
      pendingCatalog = undefined;
      throw error;
    });
  return pendingCatalog;
}
