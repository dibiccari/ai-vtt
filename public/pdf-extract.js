// Turns an adventure PDF into clean text files for the AI DM. Works in the browser (window.PdfExtract) and in Node (require).
// Input is a pdf.js document. Pages are read in column order, joined into paragraphs, and split into chapters from the PDF's bookmarks.
(function (root) {
  'use strict';

  var median = function (arr) {
    if (!arr.length) return 0;
    var s = arr.slice().sort(function (a, b) { return a - b; });
    return s[Math.floor(s.length / 2)];
  };

  // The text layer of scanned books has a few predictable slips: dice written with a lowercase L, and a "/" read as "j".
  function cleanOcr(text) {
    return text
      .replace(/\b[lI]d(\d{1,3})\b/g, '1d$1')
      .replace(/(\bft\.)j(\d)/g, '$1/$2')
      .replace(/\((\d+) ?[lI]d(\d)/g, '($1d$2');
  }

  // One page -> markdown-ish text, reading the left column before the right, with full-width lines splitting the page into bands.
  async function pageText(page) {
    var vp = page.getViewport({ scale: 1 });
    var W = vp.width;
    var H = vp.height;
    var content = await page.getTextContent();
    var items = [];
    content.items.forEach(function (it) {
      if (!it.str || !it.str.trim()) return;
      if (/^[~\-\u2013\u2014_=\s]+$/.test(it.str)) return;      // rules and dashed lines
      if (it.transform[5] < H * 0.058) return;                     // running footers and page numbers
      items.push({ str: it.str, x: it.transform[4], y: it.transform[5], w: it.width, h: Math.abs(it.transform[3]) || it.height || 10 });
    });
    if (!items.length) return '';
    var bodySize = median(items.map(function (i) { return i.h; }));

    var mid = W / 2;
    items.forEach(function (it) {
      var spans = it.x < mid - W * 0.05 && it.x + it.w > mid + W * 0.05;
      it.col = spans ? 'span' : (it.x + it.w / 2 < mid ? 0 : 1);
    });

    // Group items into lines (same column, same baseline).
    function toLines(list) {
      var sorted = list.slice().sort(function (a, b) { return b.y - a.y || a.x - b.x; });
      var lines = [];
      sorted.forEach(function (it) {
        var line = lines.length ? lines[lines.length - 1] : null;
        if (line && Math.abs(line.y - it.y) <= Math.max(2, it.h * 0.4)) {
          line.items.push(it);
          line.h = Math.max(line.h, it.h);
        } else {
          lines.push({ y: it.y, h: it.h, items: [it] });
        }
      });
      lines.forEach(function (line) {
        line.items.sort(function (a, b) { return a.x - b.x; });
        var text = '';
        var prev = null;
        line.items.forEach(function (it) {
          if (prev) {
            var gap = it.x - (prev.x + prev.w);
            if (gap > it.h * 0.18 && !/\s$/.test(text) && !/^\s/.test(it.str)) text += ' ';
          }
          text += it.str;
          prev = it;
        });
        line.text = text.replace(/\s+/g, ' ').trim();
        var weight = 0, total = 0;
        line.items.forEach(function (it) { weight += it.h * it.str.length; total += it.str.length; });
        line.avgH = total ? weight / total : line.h;
      });
      return lines.filter(function (l) { return l.text; });
    }

    // Bands: full-width lines divide the page; inside a band, the left column reads before the right.
    var spanItems = items.filter(function (i) { return i.col === 'span'; });
    var spanLines = toLines(spanItems);
    var colItems = items.filter(function (i) { return i.col !== 'span'; });
    var ordered = [];
    var bandTop = Infinity;
    var boundaries = spanLines.map(function (l) { return l.y; });
    boundaries.push(-Infinity);
    var spanIndex = 0;
    boundaries.forEach(function (bottom) {
      var inBand = colItems.filter(function (i) { return i.y < bandTop && i.y > bottom; });
      [0, 1].forEach(function (c) {
        toLines(inBand.filter(function (i) { return i.col === c; })).forEach(function (l) { l.col = c; ordered.push(l); });
      });
      if (spanIndex < spanLines.length) ordered.push(spanLines[spanIndex]);
      spanIndex++;
      bandTop = bottom;
    });

    // Lines -> paragraphs and headings.
    var out = [];
    var para = '';
    var lastLine = null;
    var prevGap = 0;
    var flush = function () { if (para) out.push(para); para = ''; };
    ordered.forEach(function (line) {
      var big = line.avgH >= bodySize * 1.28 || (line.h >= bodySize * 1.28 && line.text.length <= 45);
      var heading = big && line.text.length < 90 && /[A-Za-z0-9]{2,}/.test(line.text);
      var gap = lastLine && lastLine.col === line.col ? lastLine.y - line.y : 0;
      var lineH = Math.max(line.h, lastLine ? lastLine.h : 0);
      var gapBreak = gap > 0 && gap > lineH * 1.3 && gap > (prevGap ? prevGap * 1.4 : lineH * 2.3);
      var bullet = /^[\u2022\u00b7\u25aa\u25e6]/.test(line.text);
      var newBlock = !lastLine || lastLine.col !== line.col || gapBreak || heading || lastLine.heading || bullet;
      if (newBlock) flush();
      if (heading) {
        out.push('## ' + line.text);
      } else if (para) {
        if (/[a-z]-$/.test(para) && /^[a-z]/.test(line.text)) para = para.slice(0, -1) + line.text;
        else para += ' ' + line.text;
      } else {
        para = line.text;
      }
      line.heading = heading;
      prevGap = newBlock ? 0 : gap;
      lastLine = line;
    });
    flush();
    return cleanOcr(out.join('\n\n'));
  }

  async function pageOfDest(pdf, dest) {
    try {
      var d = typeof dest === 'string' ? await pdf.getDestination(dest) : dest;
      if (!Array.isArray(d) || !d.length) return null;
      var ref = d[0];
      if (typeof ref === 'number') return ref + 1;
      return (await pdf.getPageIndex(ref)) + 1;
    } catch (e) {
      return null;
    }
  }

  // Chapters from the top level of the PDF's bookmarks; falls back to fixed-size chunks.
  async function chapterStarts(pdf, chunk) {
    var starts = [];
    try {
      var outline = await pdf.getOutline();
      if (outline) {
        for (var i = 0; i < outline.length; i++) {
          var p = await pageOfDest(pdf, outline[i].dest);
          if (p) starts.push({ title: outline[i].title.replace(/\s+/g, ' ').trim(), page: p });
        }
      }
    } catch (e) { /* no bookmarks */ }
    var seen = {};
    starts = starts.filter(function (s) { if (seen[s.page]) return false; seen[s.page] = true; return true; }).sort(function (a, b) { return a.page - b.page; });
    if (starts.length >= 2) {
      if (starts[0].page > 1) starts.unshift({ title: 'Front matter', page: 1 });
      return { starts: starts, fromBookmarks: true };
    }
    starts = [];
    for (var pg = 1; pg <= pdf.numPages; pg += chunk) starts.push({ title: 'Pages ' + pg + '-' + Math.min(pdf.numPages, pg + chunk - 1), page: pg });
    return { starts: starts, fromBookmarks: false };
  }

  // Returns [{ title, startPage, endPage, text }]. onProgress(done, total) is optional.
  async function extractDocument(pdf, onProgress, chunkPages) {
    var plan = await chapterStarts(pdf, chunkPages || 8);
    var chapters = plan.starts.map(function (s, i) {
      return { title: s.title, startPage: s.page, endPage: i + 1 < plan.starts.length ? plan.starts[i + 1].page - 1 : pdf.numPages, text: '' };
    });
    var texts = [];
    for (var p = 1; p <= pdf.numPages; p++) {
      var page = await pdf.getPage(p);
      texts[p] = await pageText(page);
      if (onProgress) onProgress(p, pdf.numPages);
    }
    chapters.forEach(function (c) {
      var parts = [];
      for (var p2 = c.startPage; p2 <= c.endPage; p2++) if (texts[p2]) parts.push(texts[p2]);
      c.text = parts.join('\n\n');
    });
    return { chapters: chapters.filter(function (c) { return c.text.trim(); }), fromBookmarks: plan.fromBookmarks };
  }

  var slug = function (s) { return String(s).toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'part'; };

  // Chapters -> files named like 03-the-goblin-arrows.md, each starting with its title and page range.
  function toFiles(chapters) {
    return chapters.map(function (c, i) {
      var n = String(i + 1).padStart(2, '0');
      return { name: n + '-' + slug(c.title) + '.md', text: '# ' + c.title + ' (PDF pages ' + c.startPage + '-' + c.endPage + ')\n\n' + c.text + '\n' };
    });
  }

  var api = { pageText: pageText, extractDocument: extractDocument, toFiles: toFiles };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PdfExtract = api;
})(typeof window !== 'undefined' ? window : globalThis);
