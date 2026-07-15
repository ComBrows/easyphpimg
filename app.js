webix.ready(function () {
    // Derived from app.js's own URL rather than window.location, so this
    // keeps working unmodified no matter which folder the app is deployed
    // into (mirrors the SCRIPT_NAME-based base path detection in index.php).
    var basePath = (function () {
        var script = document.currentScript || document.querySelector('script[src*="app.js"]');
        return script.src.replace(/app\.js(\?.*)?$/, "");
    })();

    var state = {
        page: 1,
        limit: 24
    };

    function loadPage(page) {
        state.page = page;
        webix.ajax().get(basePath + "api/images", { page: state.page, limit: state.limit }).then(function (res) {
            var data = res.json();
            $$("gallery").clearAll();
            $$("gallery").parse(data.items);
            $$("pager").define("count", data.total);
            $$("pager").refresh();
        });
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

    function showDetail(id) {
        webix.ajax().get(basePath + "api/images/" + id).then(function (res) {
            var info = res.json();
            var win = getDetailWindow();

            $$("detailTitle").setValue(webix.template.escape(info.name));
            $$("detailImageArea").setHTML(
                "<div class='detail-window-image'>" +
                    "<img src='" + basePath + "api/images/" + id + "/raw'>" +
                    "</div>"
            );
            $$("detailMetaArea").setHTML(
                "<div class='detail-window-meta'>" +
                    "<div><b>Size:</b> " + info.size_human + "</div>" +
                    "<div><b>Dimensions:</b> " + (info.width || "?") + " x " + (info.height || "?") + "</div>" +
                    "<div><b>Type:</b> " + info.mime + "</div>" +
                    "<div><b>Created:</b> " + info.created + "</div>" +
                    "<div><b>Modified:</b> " + info.modified + "</div>" +
                    "</div>"
            );

            win.show();
            centerWindow(win);
        });
    }

    function centerWindow(win) {
        win.setPosition(
            Math.round((window.innerWidth - win.$width) / 2),
            Math.round((window.innerHeight - win.$height) / 2)
        );
    }

    webix.ui({
        rows: [
            {
                view: "toolbar",
                height: 44,
                elements: [
                    { view: "label", label: "Image Explorer" }
                ]
            },
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
});
