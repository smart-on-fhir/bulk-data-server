(function($, Lib, CFG, ENV) {

    var map = {
        err       : { type: "string", defaultValue: "" },
        page      : { type: "number", defaultValue: CFG.defaultPageSize || 10000 },
        auth_type : { type: "string", defaultValue: "jwks_url" },
        jwks      : { type: "object", defaultValue: null },
        jwks_url  : { type: "string", defaultValue: "" },
        tlt       : { type: "number", defaultValue: CFG.defaultTokenLifeTime || 15 },
        dur       : { type: "number", defaultValue: CFG.defaultWaitTime || 10 },
        m         : { type: "number", defaultValue: 1 },
        stu       : { type: "number", defaultValue: 4 },
        del       : { type: "number", defaultValue: 0 },
        secure    : { type: "number", defaultValue: 1 },
    };

    var MODEL    = new Lib.Model();
    var BASE_URL = window.location.href.split("?")[0].replace(/\/(index\.html)?$/, "");

    /**
     * Loads params from the query string into the model
     */
    function load() {
        var query = Lib.getUrlQuery();
        for (var key in map) {
            var value = map[key].defaultValue;
            if (key in query) {
                var value = query[key];
                if (map[key].type == "number") {
                    value *= 1;
                }
                if (map[key].type == "object") {
                    value = value ? JSON.parse(Lib.base64UrlDecode(value)) : null;
                }
            }
            MODEL.set(key, value);
        }
    }

    /**
     * Writes parameters from the model to the query string
     */
    function save() {
                
        var qs = {};

        for (var key in map) {
            var value = MODEL.get(key);
            if (map[key].type == "number") {
                value *= 1;
            }
            if (map[key].type == "object") {
                value = value ? Lib.base64UrlEncode(JSON.stringify(value)) : null;
            }
            if (value !== undefined && value !== map[key].defaultValue) {
                qs[key] = value;
            }
        }

        var sortedQs = Object.keys(qs)
            .filter(function(key) {
                return qs[key] !== undefined;
            })
            .sort()
            .map(function(key) {
                return key + "=" + encodeURIComponent(qs[key]);
            })
            .join("&");

        var newUrl = location.href.split("?")[0];
        if (sortedQs) {
            newUrl += "?" + sortedQs;
        }
        if (history && newUrl != location.href) {
            if (typeof history.replaceState == "function") {
                history.replaceState({}, document.title, newUrl);
            } else {
                location.replace(newUrl);
            }
        }
    }

    /**
     * Generates new client_id and saves it into the model. Note that this
     * function should only be called if we have the "jwks_url" OR "jwks" is set
     * already. Additionally, the access token lifetime ("tlt"), the simulated
     * deleted % (del) and the the simulated error ("err") will also be included
     * into the client_id if available.
     */
    function generateClientId() {
        var auth_type = MODEL.get("auth_type"),
            key       = auth_type == "jwks" ?
                JSON.stringify(MODEL.get("jwks")) :
                MODEL.get("jwks_url");
        
        if (key) {
            var tokenLifetime = +MODEL.get("tlt");
            var authError     =  MODEL.get("err");
            var params        = {};

            params[auth_type] = key;

            if (tokenLifetime) {
                params.dur = tokenLifetime;
            }
            if (authError) {
                params.err = authError;
            }

            $.ajax({
                url   : "/auth/register",
                method: "POST",
                data  : params
            }).then(
                function(client_id) {
                    MODEL.set("client_id", client_id);
                },
                function(error) {
                    MODEL.set("client_id", "");
                }
            );
        }
        else {
            MODEL.set("client_id", "");
        }
    }

    /**
     * computes the launchData which is a base64-encoded url segment containing
     * advanced implementation-specific options
     */
    function updateLaunchData(e) {
        MODEL.set("launchData", Lib.base64UrlEncode(JSON.stringify({
            err   :  MODEL.get("err"),
            page  : +MODEL.get("page"),
            dur   : +MODEL.get("dur"),
            tlt   : +MODEL.get("tlt"),
            m     : +MODEL.get("m"),
            stu   : +MODEL.get("stu"),
            del   : +MODEL.get("del"),
            secure: +MODEL.get("secure"),
        })));
        MODEL.set("openLaunchData", Lib.base64UrlEncode(JSON.stringify({
            err   :  MODEL.get("err"),
            page  : +MODEL.get("page"),
            dur   : +MODEL.get("dur"),
            tlt   : +MODEL.get("tlt"),
            m     : +MODEL.get("m"),
            stu   : +MODEL.get("stu"),
            del   : +MODEL.get("del"),
            secure: 0,
        })));
    }

    /**
     * Setup Google Analytics if enabled using the GOOGLE_ANALYTICS_ID env var
     */
    function setupGoogleAnalytics() {
        if (!ENV.GOOGLE_ANALYTICS_ID) {
            return;
        }
        $('<script async src="https://www.googletagmanager.com/gtag/js?id=' +
            ENV.GOOGLE_ANALYTICS_ID + '"/>').appendTo("body");
        // @ts-ignore
        window.dataLayer = window.dataLayer || [];
        // @ts-ignore
        window.gtag = function(){
            // @ts-ignore
            dataLayer.push(arguments);
        }
        // @ts-ignore
        gtag('js', new Date()); 
        // @ts-ignore
        gtag('config', ENV.GOOGLE_ANALYTICS_ID);
    }

    /**
     * Event handler attached on form elements
     */
    function onChange(e) {
        var prop = this.getAttribute("data-prop");
        var val = $(this).val();
        if (prop == "jwks") {
            if (e.type == "input") {
                return true;
            }
            try {
                val = $.parseJSON(val);
            } catch (ex) {
                return;
            }
        }
        MODEL.set(prop, val);
    }

    function bindEventHandlers() {

        // 1. DOM listeners ----------------------------------------------------

        // readonly inputs select themselves on focus
        $("[readonly]").on("focus", function() {
            var self = this;
            setTimeout(function() {
                $(self).select();
            }, 100);
        });

        // Activate the bookmark button
        $("#bookmark").click(function(e) {
            e.preventDefault();
            window.open(
                "http://www.google.com/bookmarks/mark" + 
                "?op=edit" +
                "&output=po‌​pup" +
                "&bkmk=" + encodeURIComponent(location.href) +
                "&title=Bulk%20Data%20Server" +
                "&labels=Bulk%20Data%20Server" +
                "&annotation=" + encodeURIComponent(
                    "Bulk Files Service Launch on Bulk Data Demo Server"
                ),
                "_blank"
            );
        });

        // Set the auth type
        $(":radio[name='auth_type']").on("change", function() {
            MODEL.set("auth_type", $(":radio[name='auth_type']:checked").val());
        });

        // Set the auth type
        $(":radio[name='secure']").on("change", function() {
            MODEL.set("secure", $(":radio[name='secure']:checked").val());
        });

        // Activate the "Generate Keys" button
        $("#generate-keys a[data-alg]").click(function(e) {
            e.preventDefault();
            var alg = $(e.target).attr("data-alg");
            $.ajax("/generator/jwks?alg=" + alg).then(function(json) {
                MODEL.set("jwks", json);
            });
        });

        // Make the download link work in IE
        $("#download").on("click", function(e) {
            if(window.navigator.msSaveOrOpenBlob) {
                e.preventDefault();
                var fileData = [this.href];
                var blobObject = new Blob(fileData);
                var fileName = this.getAttribute("download") || "";
                window.navigator.msSaveOrOpenBlob(blobObject, fileName);
            }
        });

        // prevent form submission
        $("form").on("submit", function(e) {
            e.preventDefault();
        });

        // Update the model when form elements change
        $(document).on("change", "input[data-prop],textarea[data-prop],select[data-prop]", onChange);

        // Also update the model while typing in input/textarea
        $(document).on("input", "input[data-prop],textarea[data-prop]", onChange);

        
        // 2. Data listeners ---------------------------------------------------

        MODEL.on("change:auth_type", function(e) {
            $(":radio[name='auth_type']").each(function(i, o) {
                $(o).prop("checked", o.value === e.data.newValue)
                    .parent().toggleClass("active", o.value === e.data.newValue);
            });

            $("#generate-keys, #jwks-json").toggle(e.data.newValue == "jwks");
            $("#jwks_url").toggle(e.data.newValue == "jwks_url", true);
        });

        MODEL.on("change:secure", function(e) {
            $(":radio[name='secure']").each(function(i, o) {
                $(o).prop("checked", o.value === e.data.newValue)
                    .parent().toggleClass("active", o.value === e.data.newValue + "");
            });
        });

        // When fhir_server_url changes update the "Try Sample App" link
        MODEL.on("change:sampleAppUrl", function(e) {
            $("#try-app-link").attr("href", MODEL.get("sampleAppUrl"));
        });


        // If jwks, err or tlt changes, (re)generate the client_id
        MODEL.on("change:jwks change:jwks_url change:err change:tlt", generateClientId);

        // Whenever the advanced options change (re)generate the launchData
        MODEL.on("change:page change:dur change:del change:err change:tlt change:m change:stu change:secure", updateLaunchData);
        
        // Whenever launchData changes, update the fhir server fhir_server_url
        MODEL.on("change:launchData", function updateFhirUrl(e) {
            MODEL.set(
                "fhir_server_url",
                BASE_URL + "/" + MODEL.get("launchData") + "/fhir"
            );
        });

        // Whenever openLaunchData changes, update the sampleAppUrl
        MODEL.on("change:openLaunchData", function updateFhirUrl(e) {
            MODEL.set(
                "sampleAppUrl",
                "/sample-app/index.html?server=" + encodeURIComponent(BASE_URL + "/" + MODEL.get("openLaunchData") + "/fhir")
            );
        });

        // Update the download link href when some of the relevant data changes
        MODEL.on([
            "change:jwks",
            "change:jwks_url",
            "change:auth_type",
            "change:client_id",
            "change:fhir_server_url",
            "change:auth_url"
        ], function() {
            var client_id = MODEL.get("client_id");
            $("#download").attr(
                "href",
                'data:text/plain;base64,' +
                btoa(JSON.stringify({
                    jwks       : MODEL.get("auth_type") == "jwks"     ? MODEL.get("jwks")     : undefined,
                    jwks_url   : MODEL.get("auth_type") == "jwks_url" ? MODEL.get("jwks_url") : undefined,
                    client_id  : client_id,
                    fhir_url   : MODEL.get("fhir_server_url"),
                    token_url  : MODEL.get("auth_url")
                }, null, 4))
            ).attr("disabled", !client_id);
        });

        // On any change - if there is a corresponding field - update it and
        // then highlight it
        MODEL.on("change", function(e) {
            var $el = $('[data-prop="' + e.data.name + '"]');
            if ($el.length) {
                if (map[e.data.name] && map[e.data.name].type == "object") {
                    $el.val(e.data.newValue ? JSON.stringify(e.data.newValue, null, 4) : "");
                } else {
                    $el.val(e.data.newValue);
                }
                $el.highlight();
            }
        });

        // Display the table with available groups
        MODEL.on("change:stu change:m", function updateFhirUrl(e) {
            if (MODEL.get("stu") && MODEL.get("m")) { // skip double fetch on load
                const url = BASE_URL + "/" + MODEL.get("openLaunchData") + "/fhir/Group"
                fetch(url).then(r => r.json()).then(bundle => {
                    $("#groups-table tbody").html(bundle.entry.map((entry) => `<tr><td class="hidden-xs"><i class="glyphicon glyphicon-folder-open" aria-hidden="true">&nbsp;</i>${
                        entry.resource.name}</td><td><code>${entry.resource.id}</code></td><td>${
                            entry.resource.quantity.toLocaleString()}</td></tr>`
                    ));
                }, console.error)
            }
        });
    }

    $(function init() {
        $("#loading").hide();
        $("#content").show();
        bindEventHandlers();
        MODEL.set("auth_url", BASE_URL + "/auth/token");
        MODEL.set("auth_type", "jwks_url");
        MODEL.on("change", function(e) {
            // console.log("Changed " + e.data.name + ": ", MODEL.dump());
            save();
        });
        load();
        setupGoogleAnalytics();
        setTimeout(function() {
            $("body").addClass("loaded");
        }, 1000);
    });

// @ts-ignore
})(jQuery, Lib, CFG, ENV);
