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

    function showDetail(id) {
        webix.ajax().get(basePath + "api/images/" + id).then(function (res) {
            var info = res.json();
            webix.modalbox({
                title: webix.template.escape(info.name),
                width: "900",
                text: "<div class='detail-modal'>" +
                    "<img src='" + basePath + "api/images/" + id + "/raw' class='detail-image'>" +
                    "<div class='detail-meta'>" +
                    "<div><b>Size:</b> " + info.size_human + "</div>" +
                    "<div><b>Dimensions:</b> " + (info.width || "?") + " x " + (info.height || "?") + "</div>" +
                    "<div><b>Type:</b> " + info.mime + "</div>" +
                    "<div><b>Created:</b> " + info.created + "</div>" +
                    "<div><b>Modified:</b> " + info.modified + "</div>" +
                    "</div>" +
                    "</div>",
                buttons: ["Close"]
            });
        });
    }

    webix.ui({
        rows: [
            {
                view: "toolbar",
                elements: [
                    { view: "label", label: "Image Explorer" }
                ]
            },
            {
                view: "dataview",
                id: "gallery",
                select: true,
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

    loadPage(1);
});
