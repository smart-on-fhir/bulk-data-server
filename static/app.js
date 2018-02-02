(function() {

    var map = {
        err       : { type: "string", defaultValue: "" },
        iss       : { type: "string", defaultValue: "" },
        page      : { type: "number", defaultValue: CFG.defaultPageSize || 10000 },
        public_key: { type: "string", defaultValue: "" },
        tlt       : { type: "number", defaultValue: CFG.defaultTokenLifeTime || 15 },
        dur       : { type: "number", defaultValue: CFG.defaultWaitTime || 10 },
        m         : { type: "number", defaultValue: 1 }
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
     * function should only be called if we have the "iss" and "public_key" set
     * already. Additionally, the access token lifetime ("tlt") and the
     * simulated error ("err") will also be included to the client_id if
     * available.
     */
    function generateClientId() {
        var iss = MODEL.get("iss"),
            key = MODEL.get("public_key");
        
        if (iss && key) {
            var tokenLifetime = +MODEL.get("tlt");
            var authError     =  MODEL.get("err");
            var params = {
                iss    : iss,
                pub_key: key
            };
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
            }).then(function(client_id) {
                MODEL.set("client_id", client_id);
            });
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
            err :  MODEL.get("err"),
            page: +MODEL.get("page"),
            dur : +MODEL.get("dur"),
            tlt : +MODEL.get("tlt"),
            m   : +MODEL.get("m")
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
        window.dataLayer = window.dataLayer || [];
        window.gtag = function(){
            dataLayer.push(arguments);
        }
        gtag('js', new Date()); 
        gtag('config', ENV.GOOGLE_ANALYTICS_ID);
    }

    /**
     * Event handler attached on form elements
     */
    function onChange() {
        MODEL.set(this.getAttribute("data-prop"), $(this).val());
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
                "&title=SMART%20Launcher" +
                "&labels=SMART%20Launcher" +
                "&annotation=" + encodeURIComponent(
                    "Bulk Files Service Launch on Bulk Data Demo Server"
                ),
                "_blank"
            );
        });

        // Activate the "Generate Keys" button
        $("#generate-keys").click(function() {
            $.ajax("/generator/rsa?enc=base64").then(function(json) {
                MODEL.set("public_key"     , json.publicKey);
                MODEL.set("last_public_key", json.publicKey);
                MODEL.set("private_key"    , json.privateKey);
            });
        });

        // Activate the "base64 encode key" button
        $("#encode-key").click(function() {
            MODEL.set("public_key", btoa(MODEL.get("public_key")));
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

        // When fhir_server_url changes update the "Try Sample App" link
        MODEL.on("change:fhir_server_url", function(e) {
            $("#try-app-link").attr(
                "href",
                "/sample-app/index.html?server=" +
                encodeURIComponent(e.data.newValue)
            );
        });

        // Show/hide the "base64 encode this key" button as needed
        MODEL.on("change:public_key", function() {
            var new_key = MODEL.get("public_key");
            $("#encode-key").toggleClass(
                "hidden",
                String(new_key || "").search(/^\s*--/) !== 0
            );
        });

        // Show/hide the "Show Private Key" button as needed
        MODEL.on("change:public_key change:last_public_key", function() {
            var new_key = MODEL.get("public_key");
            var old_key = MODEL.get("last_public_key");
            $("#show-private-key").toggleClass("hidden", !new_key || new_key != old_key);
        });

        // If iss, public_key, err or tlt changes, (re)generate the client_id
        MODEL.on("change:iss change:public_key change:err change:tlt", generateClientId);

        // Whenever the advanced options change (re)generate the launchData
        MODEL.on("change:page change:dur change:err change:tlt change:m", updateLaunchData);
        
        // Whenever launchData changes, update the fhir server fhir_server_url
        MODEL.on("change:launchData", function updateFhirUrl(e) {
            MODEL.set(
                "fhir_server_url",
                BASE_URL + "/" + MODEL.get("launchData") + "/fhir"
            );
        });

        // Update the download link href when some of the relevant data changes
        MODEL.on([
            "change:private_key",
            "change:client_id",
            "change:fhir_server_url",
            "change:auth_url",
            "change:iss",
        ], function() {
            $("#download").attr(
                "href",
                'data:text/plain;base64,' +
                btoa(JSON.stringify({
                    private_key: MODEL.get("private_key"),
                    client_id  : MODEL.get("client_id"),
                    fhir_url   : MODEL.get("fhir_server_url"),
                    token_url  : MODEL.get("auth_url"),
                    service_url: MODEL.get("iss")
                }, null, 4))
            );
        });

        // On any change - if there is a corresponding field - update it and
        // then highlight it
        MODEL.on("change", function(e) {
            var $el = $('[data-prop="' + e.data.name + '"]');
            if ($el.length) {
                $el.val(e.data.newValue).highlight();
            }
        });
    }

    $(function init() {
        $("#loading").hide();
        $("#content").show();
        bindEventHandlers();
        MODEL.set("auth_url", BASE_URL + "/auth/token");
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

})();