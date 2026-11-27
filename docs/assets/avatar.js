(function () {
  "use strict";

  var SKIN = ["#f6d5b3", "#ecc09a", "#dda875", "#c98d5a", "#a96f43", "#82502f"];
  var HAIR = ["#241a14", "#3a2618", "#5b3a21", "#8a5a2f", "#c79a5b", "#191a1f", "#a33b24", "#d8c07a", "#6b6f76"];
  var EYE = ["#22262b", "#2c4c73", "#356b45", "#4a2f23", "#5b2d6b"];
  var BG = ["#24282c", "#263229", "#332a33", "#28313d", "#352d24"];

  function hash(text) {
    var h = 2166136261;
    for (var i = 0; i < text.length; i++) {
      h ^= text.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  function rng(seed) {
    var state = seed >>> 0;
    return function () {
      state = (state + 0x6D2B79F5) >>> 0;
      var t = Math.imul(state ^ (state >>> 15), 1 | state);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function shade(hex, amount) {
    var n = parseInt(hex.slice(1), 16);
    var r = (n >> 16) & 255;
    var g = (n >> 8) & 255;
    var b = n & 255;
    var shift = 255 * amount;
    var clamp = function (value) {
      return Math.max(0, Math.min(255, Math.round(value + shift)));
    };
    return "#" + ((1 << 24) + (clamp(r) << 16) + (clamp(g) << 8) + clamp(b)).toString(16).slice(1);
  }

  function makeArt(nick) {
    var key = String(nick || "?").trim().toLowerCase() || "?";
    var random = rng(hash(key));

    var skin = SKIN[Math.floor(random() * SKIN.length)];
    var hair = HAIR[Math.floor(random() * HAIR.length)];
    var eye = EYE[Math.floor(random() * EYE.length)];
    var bg = BG[Math.floor(random() * BG.length)];
    var beard = random() < 0.22;

    var grid = [];
    for (var y = 0; y < 8; y++) {
      var row = [];
      for (var x = 0; x < 8; x++) {
        row.push(skin);
      }
      grid.push(row);
    }

    for (var tx = 0; tx < 8; tx++) {
      grid[0][tx] = hair;
      grid[1][tx] = hair;
      if (random() < 0.55) {
        grid[2][tx] = hair;
      }
    }

    grid[2][0] = hair;
    grid[2][7] = hair;
    grid[3][0] = hair;
    grid[3][7] = hair;
    grid[4][0] = hair;
    grid[4][7] = hair;

    grid[2][2] = shade(skin, -0.1);
    grid[2][5] = shade(skin, -0.1);
    grid[3][2] = eye;
    grid[3][5] = eye;
    grid[6][3] = shade(skin, -0.22);
    grid[6][4] = shade(skin, -0.22);

    if (beard) {
      for (var by = 5; by < 8; by++) {
        for (var bx = 1; bx < 7; bx++) {
          if (random() < 0.72) {
            grid[by][bx] = hair;
          }
        }
      }
    }

    for (var sy = 2; sy < 8; sy++) {
      grid[sy][7] = shade(grid[sy][7], -0.16);
    }

    return { grid: grid, bg: bg };
  }

  function svg(nick, options) {
    var size = options && options.size ? options.size : 64;
    var art = makeArt(nick);
    var parts = ['<rect width="8" height="8" fill="' + art.bg + '"/>'];

    for (var y = 0; y < 8; y++) {
      for (var x = 0; x < 8; x++) {
        parts.push('<rect x="' + x + '" y="' + y + '" width="1" height="1" fill="' + art.grid[y][x] + '"/>');
      }
    }

    return (
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8" width="' + size + '" height="' + size +
      '" shape-rendering="crispEdges" focusable="false" aria-hidden="true">' + parts.join("") + "</svg>"
    );
  }

  function dataUri(nick) {
    return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg(nick, { size: 64 }));
  }

  function mount(element, nick, size) {
    if (!element) { return; }
    element.innerHTML = svg(nick, { size: size || 48 });
    element.classList.add("px-avatar");
  }

  window.MTAvatar = { svg: svg, dataUri: dataUri, mount: mount };
})();
