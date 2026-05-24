// Synapse Popup Action script
document.addEventListener('DOMContentLoaded', () => {
  const searchInput = document.getElementById('search-input');
  const listContainer = document.getElementById('list-container');

  // Load and display saved memory capsules
  function displayCapsules(query = '') {
    chrome.storage.local.get({ capsules: [] }, (data) => {
      let capsules = data.capsules;
      
      // Filter list if query exists
      if (query) {
        const term = query.toLowerCase();
        capsules = capsules.filter(c => 
          c.topic.toLowerCase().includes(term) || 
          c.summary.toLowerCase().includes(term)
        );
      }

      if (capsules.length === 0) {
        listContainer.innerHTML = `
          <div style="font-size: 11px; text-align: center; color: var(--text-muted); padding: 24px 0;">
            ${query ? 'No matching capsules found.' : 'No saved capsules in vault.'}
          </div>
        `;
        return;
      }

      listContainer.innerHTML = capsules.map(c => `
        <div class="capsule-card" style="position: relative;">
          <div class="capsule-title">${c.topic}</div>
          <div class="capsule-desc">${c.summary}</div>
          <div style="display:flex; justify-content:space-between; align-items:center; margin-top:6px; font-size:9px; color:#6b7280; font-family:monospace;">
            <span>${c.codeSkeleton ? 'AST Parsed' : 'Raw Text'}</span>
            <button class="delete-cap-btn" data-id="${c.id}" style="background:none; border:none; color:#ef4444; font-size:9px; cursor:pointer; padding:0;">Delete</button>
          </div>
        </div>
      `).join('');

      // Attach delete click listeners
      listContainer.querySelectorAll('.delete-cap-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.preventDefault();
          const capId = btn.getAttribute('data-id');
          deleteCapsule(capId);
        });
      });
    });
  }

  // Remove a capsule from the local storage
  function deleteCapsule(id) {
    chrome.storage.local.get({ capsules: [] }, (data) => {
      const filtered = data.capsules.filter(c => c.id !== id);
      chrome.storage.local.set({ capsules: filtered }, () => {
        displayCapsules(searchInput.value);
      });
    });
  }

  // Listen to search entries
  searchInput.addEventListener('input', (e) => {
    displayCapsules(e.target.value);
  });

  // Initial render call
  displayCapsules();
});
