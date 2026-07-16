webix.ready(function () {
    // Derived from app.js's own URL rather than window.location, so this
    // keeps working unmodified no matter which folder the app is deployed
    // into (mirrors the multi-tenant subdirectory deployments in the docs).
    var basePath = (function () {
        var script = document.currentScript || document.querySelector('script[src*="app.js"]');
        return script.src.replace(/app\.js(\?.*)?$/, "");
    })();

    var MONTH_NAMES = [
        "January", "February", "March", "April", "May", "June",
        "July", "August", "September", "October", "November", "December"
    ];

    // The full listing, fetched once and kept in memory — every filter,
    // grouping, and pagination step below runs against this array on the
    // client, with no further server round-trips beyond raw image bytes.
    var allImages = [];
    var currentFilter = null; // null, or {year, month, day} (month/day optional)

    var state = {
        page: 1,
        limit: 24
    };

    function fetchStats() {
        return webix.ajax().get(basePath + "api/images/stats").then(function (res) {
            return res.json();
        });
    }

    function formatBytes(bytes) {
        var units = ["B", "KB", "MB", "GB", "TB"];
        var value = bytes;
        var i = 0;
        while (value >= 1024 && i < units.length - 1) {
            value /= 1024;
            i++;
        }
        return value.toFixed(i > 0 ? 2 : 0) + " " + units[i];
    }

    function setLoadingProgress(fraction) {
        var bar = document.getElementById("loadingProgressBar");
        if (bar) {
            bar.style.width = (Math.min(1, Math.max(0, fraction)) * 100) + "%";
        }
    }

    function showLoadingStats(stats) {
        var sizeEl = document.getElementById("loadingSize");
        var countEl = document.getElementById("loadingCount");
        var dateEl = document.getElementById("loadingDate");
        if (sizeEl) {
            sizeEl.textContent = formatBytes(stats.total_size);
        }
        if (countEl) {
            countEl.textContent = stats.count.toLocaleString() + " files";
        }
        if (dateEl) {
            dateEl.textContent = stats.generated_at.slice(0, 10);
        }
    }

    function showLoadingError(message) {
        var box = document.querySelector(".loading-box");
        if (box) {
            box.innerHTML = "<div class='loading-title'>Failed to load: " +
                webix.template.escape(message) + "</div>";
        }
    }

    // A single request for the whole listing (gzip-compressed server-side),
    // instead of paginating through hundreds of requests at 30k+ files —
    // plain XMLHttpRequest so we get byte-level onprogress for the loading
    // bar, which webix.ajax()/fetch() don't expose.
    function fetchAllImages(stats) {
        return new Promise(function (resolve, reject) {
            var xhr = new XMLHttpRequest();
            xhr.open("GET", basePath + "api/images/all", true);

            xhr.onprogress = function (event) {
                var total = event.lengthComputable ? event.total : (stats && stats.total_size);
                if (total) {
                    setLoadingProgress(event.loaded / total);
                }
            };

            xhr.onload = function () {
                if (xhr.status >= 200 && xhr.status < 300) {
                    setLoadingProgress(1);
                    resolve(JSON.parse(xhr.responseText).items);
                } else {
                    reject(new Error("HTTP " + xhr.status));
                }
            };

            xhr.onerror = function () {
                reject(new Error("Network error while loading image list"));
            };

            xhr.send();
        });
    }

    function withDateParts(item) {
        var d = new Date(item.modified);
        item._year = d.getFullYear();
        item._month = d.getMonth() + 1;
        item._day = d.getDate();
        return item;
    }

    function filterFromTreeId(id) {
        if (id === "all") {
            return null;
        }
        var m = /^y-(\d+)(?:-m-(\d+)(?:-d-(\d+))?)?$/.exec(id);
        if (!m) {
            return null;
        }
        return {
            year: parseInt(m[1], 10),
            month: m[2] ? parseInt(m[2], 10) : null,
            day: m[3] ? parseInt(m[3], 10) : null
        };
    }

    function applyFilter(filter) {
        if (!filter) {
            return allImages;
        }
        return _.filter(allImages, function (item) {
            if (item._year !== filter.year) {
                return false;
            }
            if (filter.month !== null && item._month !== filter.month) {
                return false;
            }
            if (filter.day !== null && item._day !== filter.day) {
                return false;
            }
            return true;
        });
    }

    function buildSidebarTree() {
        var byYear = _.groupBy(allImages, "_year");
        var years = _.sortBy(_.keys(byYear), Number).reverse();

        var yearNodes = _.map(years, function (year) {
            var yearItems = byYear[year];
            var byMonth = _.groupBy(yearItems, "_month");
            var months = _.sortBy(_.keys(byMonth), Number).reverse();

            var monthNodes = _.map(months, function (month) {
                var monthItems = byMonth[month];
                var byDay = _.groupBy(monthItems, "_day");
                var days = _.sortBy(_.keys(byDay), Number).reverse();

                var dayNodes = _.map(days, function (day) {
                    return {
                        id: "y-" + year + "-m-" + month + "-d-" + day,
                        value: day + " (" + byDay[day].length + ")"
                    };
                });

                return {
                    id: "y-" + year + "-m-" + month,
                    value: MONTH_NAMES[month - 1] + " (" + monthItems.length + ")",
                    data: dayNodes
                };
            });

            return {
                id: "y-" + year,
                value: year + " (" + yearItems.length + ")",
                data: monthNodes
            };
        });

        return [
            { id: "all", value: "All images (" + allImages.length + ")" }
        ].concat(yearNodes);
    }

    function loadPage(page) {
        state.page = page;
        var filtered = applyFilter(currentFilter);
        var offset = (page - 1) * state.limit;
        var slice = filtered.slice(offset, offset + state.limit);

        $$("gallery").clearAll();
        $$("gallery").parse(slice);
        $$("pager").define("count", filtered.length);
        $$("pager").refresh();
    }

    var MIME_TYPES = {
        jpg: "image/jpeg",
        jpeg: "image/jpeg",
        png: "image/png",
        gif: "image/gif",
        webp: "image/webp",
        bmp: "image/bmp"
    };

    // The single raw-bytes fetch backs both the <img> (via an object URL)
    // and the ExifReader parse below, so metadata costs nothing beyond the
    // image download every gallery click already needed — no more separate
    // /api/images/{id} round trip. The previous object URL is revoked before
    // creating the next one so repeatedly opening images doesn't leak memory.
    var detailObjectUrl = null;

    function revokeDetailObjectUrl() {
        if (detailObjectUrl) {
            URL.revokeObjectURL(detailObjectUrl);
            detailObjectUrl = null;
        }
    }

    function getDetailWindow() {
        var win = $$("detailWindow");
        if (win) {
            return win;
        }

        return webix.ui({
            view: "window",
            id: "detailWindow",
            modal: true,
            width: Math.round(window.innerWidth * 0.7),
            height: Math.round(window.innerHeight * 0.85),
            head: {
                cols: [
                    { view: "label", id: "detailTitle", label: "" },
                    {
                        view: "icon",
                        icon: "wxi-close",
                        click: function () {
                            revokeDetailObjectUrl();
                            $$("detailWindow").hide();
                        }
                    }
                ]
            },
            body: {
                rows: [
                    { view: "template", id: "detailImageArea", template: "", gravity: 4 },
                    { view: "template", id: "detailMetaArea", template: "", gravity: 1 }
                ]
            }
        });
    }

    // ExifReader understands JPEG/TIFF/PNG/HEIC/WebP structure, not just
    // EXIF proper, so ImageWidth/ImageHeight come back for plain PNGs too —
    // but any format/corruption it doesn't recognize throws, so dimensions
    // and the optional camera/date-taken fields are only shown when present.
    function extractClientMetadata(buffer, localItem) {
        var width = null;
        var height = null;
        var dateTaken = null;
        var camera = null;

        try {
            // Tag names come back with spaces (e.g. "Image Width", not
            // "ImageWidth") in this ExifReader version — verified directly
            // against its output rather than assumed from the docs.
            var tags = ExifReader.load(buffer);
            if (tags["Image Width"]) {
                width = tags["Image Width"].value;
            }
            if (tags["Image Height"]) {
                height = tags["Image Height"].value;
            }
            if (tags.DateTimeOriginal) {
                dateTaken = tags.DateTimeOriginal.description;
            }
            if (tags.Make || tags.Model) {
                camera = [
                    tags.Make ? tags.Make.description : null,
                    tags.Model ? tags.Model.description : null
                ].filter(Boolean).join(" ");
            }
        } catch (e) {
            // Not a format/structure ExifReader can parse — dimensions and
            // camera info just won't be shown, rest of the metadata still is.
        }

        return {
            size_human: formatBytes(localItem.size),
            mime: MIME_TYPES[localItem.extension] || "application/octet-stream",
            width: width,
            height: height,
            created: localItem.created,
            modified: localItem.modified,
            dateTaken: dateTaken,
            camera: camera
        };
    }

    function renderDetailMeta(meta) {
        var rows = [
            "<div><b>Size:</b> " + meta.size_human + "</div>",
            "<div><b>Dimensions:</b> " + (meta.width || "?") + " x " + (meta.height || "?") + "</div>",
            "<div><b>Type:</b> " + meta.mime + "</div>",
            "<div><b>Created:</b> " + meta.created + "</div>",
            "<div><b>Modified:</b> " + meta.modified + "</div>"
        ];
        if (meta.camera) {
            rows.push("<div><b>Camera:</b> " + webix.template.escape(meta.camera) + "</div>");
        }
        if (meta.dateTaken) {
            rows.push("<div><b>Date taken:</b> " + webix.template.escape(meta.dateTaken) + "</div>");
        }
        return "<div class='detail-window-meta'>" + rows.join("") + "</div>";
    }

    // Bumped on every showDetail() call so a slow fetch for a previously
    // opened image can't overwrite the window after the user has already
    // clicked through to a different one.
    var detailToken = 0;

    function showDetail(id) {
        var token = ++detailToken;
        var win = getDetailWindow();
        var localItem = _.find(allImages, { id: id });

        $$("detailTitle").setValue(webix.template.escape(localItem ? localItem.name : "Loading images..."));
        $$("detailImageArea").setHTML("<div class='detail-window-image detail-placeholder'>Loading images...</div>");
        $$("detailMetaArea").setHTML("<div class='detail-window-meta detail-placeholder'>Loading images...</div>");

        win.show();
        centerWindow(win);

        fetch(basePath + "api/images/" + id + "/raw").then(function (res) {
            if (!res.ok) {
                throw new Error("HTTP " + res.status);
            }
            return res.arrayBuffer();
        }).then(function (buffer) {
            if (token !== detailToken) {
                return;
            }

            revokeDetailObjectUrl();
            detailObjectUrl = URL.createObjectURL(new Blob([buffer]));

            $$("detailImageArea").setHTML(
                "<div class='detail-window-image'><img src='" + detailObjectUrl + "'></div>"
            );
            $$("detailMetaArea").setHTML(renderDetailMeta(extractClientMetadata(buffer, localItem)));
        }).catch(function () {
            if (token !== detailToken) {
                return;
            }
            $$("detailImageArea").setHTML("<div class='detail-window-image detail-placeholder'>Image unavailable</div>");
            $$("detailMetaArea").setHTML(renderDetailMeta({
                size_human: formatBytes(localItem.size),
                mime: MIME_TYPES[localItem.extension] || "application/octet-stream",
                created: localItem.created,
                modified: localItem.modified
            }));
        });
    }

    function centerWindow(win) {
        win.setPosition(
            Math.round((window.innerWidth - win.$width) / 2),
            Math.round((window.innerHeight - win.$height) / 2)
        );
    }

    function runSearch(query) {
        var suggest = $$("searchSuggest");
        if (query.length < 3) {
            suggest.hide();
            return;
        }

        var needle = query.toLowerCase();
        var matches = _.filter(allImages, function (item) {
            return item.name.toLowerCase().indexOf(needle) !== -1;
        }).slice(0, 20);

        if (!matches.length) {
            suggest.hide();
            return;
        }

        var list = suggest.getList();
        list.clearAll();
        list.parse(_.map(matches, function (item) {
            return { id: item.id, value: item.name };
        }));
        suggest.show($$("searchBox").getInputNode());
    }

    function buildApp() {
        webix.ui({
            rows: [
                {
                    view: "toolbar",
                    height: 44,
                    elements: [
                        { view: "label", label: "Image Explorer" },
                        {
                            view: "text",
                            id: "searchBox",
                            width: 260,
                            placeholder: "Search filename (min 3 chars)...",
                            on: {
                                onTimedKeyPress: function () {
                                    runSearch(this.getValue());
                                }
                            }
                        }
                    ]
                },
                {
                    cols: [
                        {
                            view: "tree",
                            id: "sidebarTree",
                            width: 240,
                            select: true,
                            scroll: "y",
                            data: buildSidebarTree(),
                            on: {
                                onSelectChange: function () {
                                    currentFilter = filterFromTreeId(this.getSelectedId());
                                    loadPage(1);
                                }
                            }
                        },
                        {
                            rows: [
                                {
                                    view: "dataview",
                                    id: "gallery",
                                    select: true,
                                    scroll: "y",
                                    type: { width: 180, height: 210 },
                                    template: function (item) {
                                        return "<div class='thumb-wrap'>" +
                                            "<img class='thumb-img' src='" + basePath + "api/images/" + item.id + "/raw' loading='lazy'>" +
                                            "</div>" +
                                            "<div class='thumb-name'>" + webix.template.escape(item.name) + "</div>";
                                    },
                                    on: {
                                        onItemClick: function (id) {
                                            showDetail(this.getItem(id).id);
                                        }
                                    }
                                },
                                {
                                    view: "pager",
                                    id: "pager",
                                    height: 44,
                                    size: state.limit,
                                    master: false,
                                    on: {
                                        onAfterPageChange: function (page) {
                                            loadPage(parseInt(page, 10) + 1);
                                        }
                                    }
                                }
                            ]
                        }
                    ]
                }
            ]
        });

        var searchSuggest = webix.ui({
            view: "suggest",
            id: "searchSuggest",
            data: []
        });

        // The suggest view's own onItemClick doesn't fire selection events —
        // its internal list does, and by default selecting an item just
        // writes the value into the bound input. Attaching here instead
        // lets us open the detail view directly on selection.
        searchSuggest.getList().attachEvent("onItemClick", function (id) {
            searchSuggest.hide();
            $$("searchBox").setValue("");
            showDetail(id);
        });

        webix.event(window, "resize", function () {
            var win = $$("detailWindow");
            if (win && win.isVisible()) {
                win.define("width", Math.round(window.innerWidth * 0.7));
                win.define("height", Math.round(window.innerHeight * 0.85));
                win.resize();
                centerWindow(win);
            }
        });

        loadPage(1);
    }

    fetchStats().then(function (stats) {
        showLoadingStats(stats);
        return fetchAllImages(stats);
    }).then(function (items) {
        allImages = _.map(items, withDateParts);

        var loadingScreen = document.getElementById("loadingScreen");
        if (loadingScreen) {
            loadingScreen.parentNode.removeChild(loadingScreen);
        }

        buildApp();
    }).catch(function (err) {
        showLoadingError(err.message);
    });
});
