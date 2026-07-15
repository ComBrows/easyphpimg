webix.ready(function () {
    var state = {
        page: 1,
        limit: 24
    };

    function loadPage(page) {
        state.page = page;
        webix.ajax().get("/api/images", { page: state.page, limit: state.limit }).then(function (res) {
            var data = res.json();
            $$("gallery").clearAll();
            $$("gallery").parse(data.items);
            $$("pager").define("count", data.total);
            $$("pager").refresh();
        });
    }

    function showDetail(id) {
        webix.ajax().get("/api/images/" + id).then(function (res) {
            var info = res.json();
            webix.modalbox({
                title: webix.template.escape(info.name),
                text: "<div class='detail-modal'>" +
                    "<img src='/api/images/" + id + "/raw' class='detail-image'>" +
                    "<div><b>Size:</b> " + info.size_human + "</div>" +
                    "<div><b>Dimensions:</b> " + (info.width || "?") + " x " + (info.height || "?") + "</div>" +
                    "<div><b>Type:</b> " + info.mime + "</div>" +
                    "<div><b>Created:</b> " + info.created + "</div>" +
                    "<div><b>Modified:</b> " + info.modified + "</div>" +
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
                        "<img class='thumb-img' src='/api/images/" + item.id + "/raw' loading='lazy'>" +
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
