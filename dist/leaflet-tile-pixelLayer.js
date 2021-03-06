'use strict';

(function () {
  function png2GridData(options) {
    var url = options.url,
        headerData = options.data;
    return new Promise(function (resolve) {
      if (!url) resolve(headerData);
      var min = headerData.min;
      var img = new Image();
      img.src = url;

      img.onload = function () {
        var canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        var ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0);
        var imgdata = ctx.getImageData(0, 0, img.width, img.height);
        var gridData = [];

        for (var i = 0; i < imgdata.data.length; i += 4) {
          var r = imgdata.data[i].toString();
          var g = imgdata.data[i + 1].toString();
          var b = imgdata.data[i + 2].toString();
          var kValue = Number(r + g + b) - Math.abs(min);
          gridData.push(kValue);
        }

        var data = [{
          header: headerData,
          data: gridData
        }];
        resolve(data);
      };
    });
  }

  function isValue(x) {
    return x !== null && x !== undefined;
  }

  function colorInterpolator(pre, next) {
    var r = pre[0],
        g = pre[1],
        b = pre[2],
        aDiff = next[0] - r,
        gDiff = next[1] - g,
        bDiff = next[2] - b;
    return function (proportion, alpha) {
      return [Math.floor(r + proportion * aDiff), Math.floor(g + proportion * gDiff), Math.floor(b + proportion * bDiff), alpha];
    };
  }

  function floorMod(a, n) {
    return a - n * Math.floor(a / n);
  }

  function clamp(value, range) {
    return Math.max(range[0], Math.min(value, range[1]));
  }

  function proportion(value, low, high) {
    return (clamp(value, [low, high]) - low) / (high - low);
  }

  function segmentColorScale(gradient) {
    var colors = [];
    var colorInterpolators = [];
    var colorRanges = [];

    for (var i = 0; i < gradient.length - 1; i++) {
      colors.push(gradient[i + 1][0]);
      colorInterpolators.push(colorInterpolator(gradient[i][1], gradient[i + 1][1]));
      colorRanges.push([gradient[i][0], gradient[i + 1][0]]);
    }

    return function (value, alpha) {
      for (var i = 0; i < colors.length - 1 && !(value <= colors[i]); i++) {
        ;
      }

      var range = colorRanges[i];
      return colorInterpolators[i](proportion(value, range[0], range[1]), alpha);
    };
  }

  L.TilePixelLayer = L.TileLayer.extend({
    options: {
      data: null,
      overlayAlpha: 230,
      gap: 2,
      zIndex: 7,
      gradient: []
    },
    map: null,
    builder: null,
    grid: null,
    gridDataBuilt: null,
    date: null,
    replaceNaN: true,
    replaceNaNValue: 0,
    zooming: false,
    λ0: null,
    φ0: null,
    Δλ: null,
    Δφ: null,
    ni: null,
    nj: null,
    triggerDraw: [],
    initialize: function initialize(options) {
      L.setOptions(this, options);
      this.gradient = segmentColorScale(options.gradient);
    },
    createTile: function createTile(coords) {
      var dom = L.DomUtil.create('canvas', 'leaflet-pixel-tile');
      var size = this.getTileSize();
      dom.width = size.x;
      dom.height = size.y;
      if (this.zooming) return dom;
      var ctx = dom.getContext('2d');
      var bounds = {
        x: coords.x * dom.width,
        y: coords.y * dom.height,
        z: coords.z,
        w: dom.width,
        h: dom.height
      };
      var that = this;
      return that.gridDataBuilt ? that.interpolateField(ctx, bounds, function (image) {
        ctx.putImageData(image, 0, 0);
      }) : that.triggerDraw.push(function () {
        that.interpolateField(ctx, bounds, function (image) {
          ctx.putImageData(image, 0, 0);
        });
      }), dom;
    },
    onAdd: function onAdd(map) {
      var _this = this;

      var that = this;
      this.triggerDraw.splice(0, this.triggerDraw.length);
      this.map = map;
      this.handleZoom();
      png2GridData(this.options).then(function (res) {
        _this.buildGrid(res, function (t) {
          that.gridDataBuilt = t;

          for (var n = 0; n < that.triggerDraw.length; n++) {
            that.triggerDraw[n]();
          }

          that.triggerDraw = [];
        });

        _this.map.on('click', function (e) {
          var latlng = e.latlng;
          var lat = latlng.lat,
              lng = latlng.lng;
          var gridValue = that.gridDataBuilt.interpolate(lng, lat);
          _this.options.clickEvt && _this.options.clickEvt(e, gridValue);
        });

        L.TileLayer.prototype.onAdd.call(_this, map);
      });
    },
    onRemove: function onRemove(map) {
      this.gridDataBuilt = null;
      this.triggerDraw && this.triggerDraw.splice(0, this.triggerDraw.length);
      L.TileLayer.prototype.onRemove.call(this, map);
    },
    initHandlers: function initHandlers() {
      var that = this;
      this.map.on('zoomstart', function () {
        that.lastZoomDate = Date.now();
        that.options.maxNativeZoom = that._tileZoom;
        L.setOptions(that, that.options);
        that.zooming = true;
      });
    },
    handleZoom: function handleZoom() {
      var that = this;
      that.oldMapZoom = that.map.getZoom();
      that.oldTileZoom = that._tileZoom;
      clearInterval(that.map.zoomInterval);
      that.map.zoomInterval = setInterval(function () {
        if (Date.now() - that.lastZoomDate > 500 && that.zooming) {
          that.zooming = false;
          that.options.maxNativeZoom = 13;
          L.setOptions(that, that.options);
          var e = that.oldMapZoom - that.map.getZoom() > 0.2;
          var n = that.oldTileZoom != Math.floor(that.map.getZoom());
          var r = void 0 === that.oldTileZoom;

          if (e || n || r) {
            that.redraw();
            that.oldTileZoom = that._tileZoom;
            that.oldMapZoom = that.map.getZoom();
            that.options.maxNativeZoom = that._tileZoom;
            L.setOptions(that, that.options);
          }
        }
      }, 300);
    },
    createBuilder: function createBuilder(_data) {
      var that = this;
      return {
        header: _data.header,
        data: function data(i) {
          return _data.data[i];
        },
        interpolate: that.bilinearInterpolateScalar
      };
    },
    buildGrid: function buildGrid(gridData, callback) {
      var that = this;
      this.builder = this.createBuilder(gridData[0]);
      var header = this.builder.header;
      this.λ0 = header.lo1;
      this.φ0 = header.la1;
      this.Δλ = header.dx;
      this.Δφ = header.dy;
      this.ni = header.nx;
      this.nj = header.ny;
      this.date = new Date(header.refTime);
      this.date.setHours(this.date.getHours() + header.forecastTime);
      this.grid = [];

      for (var i = 0, y = 0; y < this.nj; y++) {
        var result = [];

        for (var x = 0; x < this.ni; x++, i++) {
          result[x] = this.builder.data(i);

          if (this.replaceNaN && isNaN(result[x])) {
            result[x] = this.replaceNaNValue;
          }
        }

        result.push(result[0]);
        this.grid[y] = result;
      }

      callback({
        date: this.date,
        interpolate: function interpolate(λ, φ) {
          if (!that.grid) return null;
          var i = floorMod(λ - that.λ0, 360) / that.Δλ;
          var j = (that.φ0 - φ) / that.Δφ;
          var fi = Math.floor(i),
              ci = fi + 1;
          var fj = Math.floor(j),
              cj = fj + 1;
          var row;

          if (row = that.grid[fj]) {
            var g00 = row[fi];
            var g10 = row[ci];

            if (isValue(g00) && isValue(g10) && (row = that.grid[cj])) {
              var g01 = row[fi];
              var g11 = row[ci];

              if (isValue(g01) && isValue(g11)) {
                return that.builder.interpolate(i - fi, j - fj, g00, g10, g01, g11);
              }
            }
          }

          return null;
        }
      });
    },
    pointToCoord: function pointToCoord(x, y, zoom) {
      var location = this.map.unproject(L.point(x, y), zoom);
      return [location.lng, location.lat];
    },
    createMask: function createMask(ctx, bounds) {
      if (!ctx) return null;
      var width = bounds.w;
      var height = bounds.h;
      ctx.fillStyle = 'rgba(255, 255, 255, 0.1)';
      ctx.fill();
      var imageData = ctx.getImageData(0, 0, width, height);
      var imageDataRaw = imageData.data;
      return {
        imageData: imageData,
        set: function set(x, y, color) {
          var index = 4 * (y * width + x);
          imageDataRaw[index] = color[0];
          imageDataRaw[index + 1] = color[1];
          imageDataRaw[index + 2] = color[2];
          imageDataRaw[index + 3] = color[3];
          return this;
        }
      };
    },
    bilinearInterpolateScalar: function bilinearInterpolateScalar(x, y, g00, g10, g01, g11) {
      var rx = 1 - x;
      var ry = 1 - y;
      return g00 * rx * ry + g10 * x * ry + g01 * rx * y + g11 * x * y;
    },
    interpolateField: function interpolateField(ctx, bounds, render) {
      var that = this;
      var x = bounds.x;
      var tileX = 0;
      var gap = this.options.gap;

      if (!Number.isInteger(this.options.gap) || this.options.gap < 1) {
        console.warn('Option Gap Must be interger and greater than 0!');
        gap = 2;
      }

      var xGap = gap;
      var yGap = gap;
      var mask = this.createMask(ctx, bounds);

      function interpolateColumn(x, tileX) {
        for (var defaultColor = [0, 0, 0, 1], y = bounds.y, height = 0; height <= bounds.h; y += yGap, height += yGap) {
          var color = defaultColor;
          var coord = that.pointToCoord(x, y, bounds.z);

          if (coord) {
            var λ = coord[0];
            var φ = coord[1];

            if (isFinite(λ)) {
              var gridValue = that.gridDataBuilt.interpolate(λ, φ);

              if (isValue(gridValue)) {
                color = that.gradient(gridValue, that.options.overlayAlpha);
              }
            }
          }

          for (var i = 0; i < xGap; i++) {
            for (var j = 0; j < yGap; j++) {
              mask.set(tileX + i, height + j, color);
            }
          }
        }
      }

      ;

      (function batchInterpolate() {
        var start = Date.now();

        while (tileX < bounds.w) {
          interpolateColumn(x, tileX);
          x += xGap;
          tileX += xGap;

          if (Date.now() - start > 500) {
            setTimeout(batchInterpolate, 25);
            return;
          }
        }

        render(mask.imageData);
      })();
    }
  });

  L.tilePixelLayer = function (options) {
    return new L.TilePixelLayer(options);
  };
})();