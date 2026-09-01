(() => {
  const status = document.getElementById('mcpStatus');
  const note = document.getElementById('mcpNote');

  // Replace this function with the production OCR/place endpoint.
  // It intentionally refuses to fabricate a result when the backend is not connected.
  window.GoPicAnalyzeCurrentSign = async function () {
    const state = window.GoPicDemo || {};
    if (!state.file) throw new Error('No sign image has been provided.');

    const form = new FormData();
    form.append('image', state.file);
    form.append('locationHint', state.locationHint || '');

    const response = await fetch('/api/analyze.php', {
      method: 'POST',
      body: form
    });

    if (!response.ok) {
      throw new Error(`Analysis endpoint returned ${response.status}`);
    }
    return await response.json();
  };

  if (!document.modelContext?.registerTool) {
    status.textContent = 'WebMCP unavailable in this browser';
    note.textContent =
      'This browser does not expose document.modelContext. Open the live project in a WebMCP-enabled Chrome build or compatible agent browser to discover the registered tools.';
    return;
  }

  async function registerTools() {
    await document.modelContext.registerTool({
      name: 'gopic_get_sign_context',
      title: 'Get current GoPic sign context',
      description: 'Read the storefront/sign image context currently supplied by the human on the GoPic page, including the filename, optional location hint, and any completed analysis state.',
      inputSchema: { type: 'object', properties: {} },
      annotations: { readOnlyHint: true },
      execute: async () => {
        const s = window.GoPicDemo || {};
        return JSON.stringify({
          hasImage: Boolean(s.file),
          fileName: s.fileName || null,
          locationHint: document.getElementById('locationHint')?.value?.trim() || '',
          analyzed: Boolean(s.analyzed),
          ocrText: s.ocrText || null,
          verifiedPlace: s.verifiedPlace || null
        });
      }
    });

    await document.modelContext.registerTool({
      name: 'gopic_analyze_sign',
      title: 'Analyze current sign with GoPic',
      description: 'Analyze the sign photo supplied by the human, then ground detected text against real place candidates. Use this when the user wants to identify the real place shown in the current image.',
      inputSchema: {
        type: 'object',
        properties: {
          locationHint: {
            type: 'string',
            description: 'Optional city, neighborhood, or country hint that can help distinguish businesses with the same name.'
          }
        }
      },
      annotations: { readOnlyHint: false },
      execute: async ({ locationHint = '' }) => {
        const s = window.GoPicDemo || {};
        if (!s.file) return JSON.stringify({ error: 'No image has been provided by the human yet.' });

        if (locationHint) {
          document.getElementById('locationHint').value = locationHint;
          s.locationHint = locationHint;
        } else {
          s.locationHint = document.getElementById('locationHint')?.value?.trim() || '';
        }

        const result = await window.GoPicAnalyzeCurrentSign();
        s.analyzed = true;
        s.ocrText = result.ocrText || '';
        s.candidates = result.candidates || [];
        s.verifiedPlace = result.verifiedPlace || '';
        return JSON.stringify(result);
      }
    });

    await document.modelContext.registerTool({
      name: 'gopic_get_place_candidates',
      title: 'Get GoPic place candidates',
      description: 'Return the current candidate places produced by GoPic, including evidence used to distinguish same-name businesses.',
      inputSchema: { type: 'object', properties: {} },
      annotations: { readOnlyHint: true },
      execute: async () => {
        const s = window.GoPicDemo || {};
        return JSON.stringify({
          ocrText: s.ocrText || null,
          candidates: s.candidates || [],
          verifiedPlace: s.verifiedPlace || null
        });
      }
    });

    status.classList.add('ready');
    status.innerHTML = '<i></i> 3 WebMCP tools registered';
    note.textContent =
      'WebMCP detected. Compatible agents can discover and invoke GoPic’s structured sign-to-place tools directly from this page.';
  }

  registerTools().catch((err) => {
    status.textContent = 'WebMCP registration error';
    note.textContent = `Tool registration failed: ${err.message}`;
  });
})();
