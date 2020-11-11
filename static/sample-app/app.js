(function($, Lib, moment, Prism) {

    let TIMER;

    const fhirVersions = {
        2: "FHIR DSTU2",
        3: "FHIR STU3",
        4: "FHIR R4"
    };

    const MODEL = new Lib.Model({
        fhirVersion     : null,
        error           : null,
        baseURL         : "",
        groups          : null,
        resourceCounts  : null,
        patients        : null,
        _since          : null,
        _elements       : null,
        group           : null,
        httpMethod      : "GET",
        exportType      : "",
        selectedPatients: null,
        selectedTypes   : [],
        path            : "/Patient/$export",
        showRequest     : false,
        progressValue   : 0,
        progressDuration: 0,
        progressVisible : false,
        progressMessage : "Preparing files. Please wait...",
        statusUrl       : null,
        files           : null,
        deletedFiles    : null,
        codeType        : null
    });

    // Rendering functions (Views) ---------------------------------------------
    function renderFHIRVersion(version)
    {
        if (!fhirVersions[version + ""]) {
            MODEL.set("error", `Invalid FHIR version "${version}"`);
        } else {
            $("#fhir-version").html(fhirVersions[version]);
        }
    }

    function renderError(error)
    {
        if (error) {
            $("#error").text(error).closest(".panel").show();
        } else {
            $("#error").text("").closest(".panel").hide();
        }
    }

    function renderGroupSelector(groups)
    {
        var select = $("#group").html(
            '<option value="">No Group (include all the patients)</option>'
        );
        select.append(
            '<option value="" disabled>---------------------------------------------------</option>'
        );
        $.each(groups, function(i, g) {
            var opt = $("<option/>");
            // opt.attr("value", g.resource.id);
            opt.attr("value", g.resource.identifier[0].value);
            opt.text(g.resource.name + " (" + formatNumber(g.resource.quantity) + " patients)");
            select.append(opt);
        });
    }

    function renderSinceSelector()
    {
        $("#start").html([
            '<option value="">No Time Filter (include everything)</option>',
            '<option value="' + (moment().subtract(1 , "month").format()) + '">Within the last month</option>',
            '<option value="' + (moment().subtract(1 , "year" ).format()) + '">Within the last year</option>',
            '<option value="' + (moment().subtract(5 , "years").format()) + '">Within the last 5 years</option>',
            '<option value="' + (moment().subtract(10, "years").format()) + '">Within the last 10 years</option>',
            '<option value="' + (moment().subtract(20, "years").format()) + '">Within the last 20 years</option>'
        ].join(""));
    }

    function renderPatientCheckboxes(patients)
    {
        var div = $(".patient-select-options").empty();
        
        patients.filter((o, i) => i < 10).forEach((o, i) => {
            var cb = $('<input type="checkbox" />').attr({
                value  : o.id,
                // checked: true,
                name   : "patient"
            });
            var label = $('<label/>');
            label.prepend(cb);
            label.append($('<div/>').text(o.name));
            label.append($('<span/>').text(o.id));
            div.append(label);

            if (i === patients.length - 1) {
                if ((i + 1) % 2) {
                    div.append('<span>&nbsp;</span>');
                }
                return;
            }
        });
    }

    function renderResourceCheckboxes(resources)
    {
        var div = $(".resource-check-list").empty();
        // var exportType = $(':radio[name="export-type"]:checked').val();

        $.each(resources, function(i, o) {
            var cb = $('<input type="checkbox" />');
            cb.attr({
                value  : o.name,
                checked: true,
                name   : "type"
            });
            var label = $('<label/>');
            label.text(" " + o.name);
            label.append('<small class="text-muted">&nbsp;(' + formatNumber(o.valueInteger) + ')</small>');
            label.prepend(cb);
            div.append(label);
        });
    }

    function renderFiles(files)
    {
        const $fileList = $(".file-list");

        if (files === null) {
            return $fileList.closest(".panel").addClass("hidden");
        } else {
            $fileList.closest(".panel").removeClass("hidden");
        }
        
        var len = files.length;

        if (len > 100) {
            $(".badge.file-count").text("first 100 of " + len);
            files = files.slice(0, 100);
        } else {
            $(".badge.file-count").text(len);
        }

        if (!len) {
            $fileList.html(
                '<b class="text-danger">No data was found to match your parameters</b>'
            );
        }
        else {
            $fileList.html(
                files.map(function(f) {
                    var url = f.url;
                    return '<a class="download-link text-success" rel="download" href="' + url + '">' +
                        '<i class="fa fa-file-text-o" aria-hidden="true"></i>' + 
                        '<span>' + url.split("/").pop() + '&nbsp;</span><b class="badge">' + formatNumber(f.count) + '</b></a>';
                }).join("")
            );
        }

        $fileList.closest(".panel")[0].scrollIntoView({ behavior: "smooth" });
    }

    function renderDeletedFiles(files)
    {
        const $fileList = $(".del-file-list");

        if (files === null || !files.length) {
            return $fileList.closest(".panel").addClass("hidden");
        } else {
            $fileList.closest(".panel").removeClass("hidden");
        }
        
        $fileList.html(
            files.map(function(f) {
                var url = f.url;
                return '<a class="download-link text-success" rel="download" href="' + url + '">' +
                    '<i class="fa fa-file-text-o" aria-hidden="true"></i>' + 
                    '<span>' + url.split("/").pop() + '&nbsp;</span><b class="badge">' + formatNumber(f.count) + '</b></a>';
            }).join("")
        );

        $fileList.closest(".panel")[0].scrollIntoView({ behavior: "smooth" });
    }

    function renderFileErrors(fileErrors)
    {
        const $fileList = $(".file-errors-list");

        if (fileErrors === null || !fileErrors.length) {
            return $fileList.closest(".panel").addClass("hidden");
        } else {
            $fileList.closest(".panel").removeClass("hidden");
        }
        
        var len = fileErrors.length;

        if (len > 100) {
            $(".badge.file-errors-count").text("first 100 of " + len);
            fileErrors = fileErrors.slice(0, 100);
        } else {
            $(".badge.file-errors-count").text(len);
        }

        $fileList.html(
            fileErrors.map(function(f) {
                var url = f.url;
                return '<a class="download-link text-danger" target="_blank" href="' + url + '">' +
                    '<i class="fa fa-file-text-o"></i>' + url.split("/").pop() + '</a>';
            }).join("")
        );

        $fileList.closest(".panel")[0].scrollIntoView({ behavior: "smooth" });
    }

    function renderHTTPRequest()
    {
        const showRequest = MODEL.get("showRequest");
        if (showRequest) {
            $('[name="code-type"], .copy-btn').prop("disabled", false);

            const codeType = MODEL.get("codeType");
            const { method, query, headers, body, path, url } = generateHTTPRequest();

            if (codeType == "curl") {
                const command = ["curl -v"];
                
                const options = [];
                for (const name in headers) {
                    options.push(`-H '${name}: ${headers[name]}'`);
                }
                command.push(options.join(" "));

                if (body) {
                    command.push(`-d '${JSON.stringify(body, null, 4)}'`);
                }
                command.push(`'${url}${query ? "?" + query : ""}'`);
                $("#curl").text(command.join(" ")).show();
                $("#http-headers, #http-body").hide();
            } else {

                let http = `${method} ${path}`;

                if (query) {
                    http += "?" + query;
                }

                http += "\n";

                http += `host: ${location.host}\n`;

                for (const name in headers) {
                    http += `${name}: ${headers[name]}\n`;
                }

                $("#http-headers").text(http + "\n").show();
                $("#http-body").text(body ? JSON.stringify(body, null, 4) : "").show();
                $("#curl").hide();
            }

            $("#request-code").show();
            Prism.highlightAll();
        } else {
            $("#request-code").hide();
            $('[name="code-type"], .copy-btn').prop("disabled", true);
        }
    }

    // Event Handlers ----------------------------------------------------------
    function onSelectedPatientsChange(e)
    {
        const len = e.data.newValue.length;

        MODEL.set("httpMethod", len ? "POST" : "GET");

        $(".patient-select-wrap > .form-control").text(
            len ?
                len === 1 ?
                    "One patient selected" :
                    `${len} patients selected` :
                "No patients selected"
        );
    }

    function onExportTypeChange(e)
    {
        const exportType = e.data.newValue;
        $("#group").prop("disabled", exportType == "system");
        $(".patient-select-wrap").toggleClass("disabled", exportType == "system");
        $(
            ':checkbox[value="Group"],' +
            ':checkbox[value="Practitioner"],' +
            ':checkbox[value="Organization"]'
        ).attr("disabled", exportType == "patient").closest("label")
        .toggleClass("disabled", exportType == "patient");
        MODEL.set("httpMethod", exportType == "system" ?
            "GET" :
            (MODEL.get("selectedPatients") || []).length ? "POST" : "GET"
        );
    }

    function onGroupChange(e)
    {
        const baseURL = MODEL.get("baseURL");
        const groupID = e.data.newValue;
        let url = baseURL + "/$get-patients";
        if (groupID) {
            url += "?group=" + groupID;
        }
        $.get(url).then(
            patients => MODEL.set({
                patients: patients,
                selectedPatients: []
            }),
            xhr => MODEL.set("error", getAjaxError(xhr, "Requesting '/$get-patients' returned: "))
        );
    }

    function onExportTypeOrGroupChange()
    {
        const exportType = MODEL.get("exportType");
        if (exportType == "system") {
            MODEL.set("path", "/$export");
        }
        else {
            const group = MODEL.get("group");
            if (group) {
                MODEL.set("path", `/Group/${group}/$export`);
            } else {
                MODEL.set("path", `/Patient/$export`);
            }
        }
    }

    function onErrorChange(e)
    {
        if (e.data.newValue) {
            $(".preparing-progress").addClass("hidden");
        }
        renderError(e.data.newValue);
    }

    function onFormSubmit(e)
    {
        e.preventDefault();
        const statusUrl = MODEL.get("statusUrl");
        const inTransientError = MODEL.get("inTransientError");
        if (statusUrl && inTransientError) {
            MODEL.set({
                error: "",
                inTransientError: false
            });
            waitForFiles();
        } else {
            prepareDownload();
        }
    }

    function onProgressToggle(e)
    {
        if (e.data.newValue) {
            $(".preparing-progress").removeClass("hidden")[0].scrollIntoView({ behavior: "smooth" });
        } else {
            $(".preparing-progress").addClass("hidden");
        }
    }

    function onStatusUrlChange(e)
    {
        $("#delete-export, #cancel-btn").prop("disabled", !e.data.newValue);
    }

    function onTransientErrorChange(e)
    {
        $(".btn-success > span").text(e.data.newValue ? "Retry Export" : "Start Export")
    }

    function onCodeTypeChange(e)
    {
        $('[name="code-type"][value="' + e.data.newValue + '"]').prop("checked", true);
    }

    // Other functions ---------------------------------------------------------
    function getHiddenParams(url)
    {
        var code;
        try {
            var match = url.match(/\/([^/]+)\/fhir/);
            if (match && match[1]) {
                code = JSON.parse(Lib.base64UrlDecode(match[1]));
            }
        } catch (ex) {
            code = null
        }
        finally {
            if (!code || typeof code != "object") {
                code = {}
            }
        }
        return code;
    }

    function formatNumber(n) {
        n = uInt(n);
        n = String(n).split("");
        let l = 0, out = [];

        for (let i = n.length - 1; i >= 0; i--) {
            if (l && l % 3 === 0) {
                out.unshift(",");
            }
            out.unshift(n[i]);
            l++;
        }

        return out.join("");
    }

    function uInt(x, defaultValue = 0) {
        x = parseInt(x + "", 10);
        if (isNaN(x) || !isFinite(x) || x < 0) {
            x = uInt(defaultValue, 0);
        }
        return x;
    }

    function generateHTTPRequest()
    {
        const httpMethod = MODEL.get("httpMethod");
        const baseURL    = MODEL.get("baseURL")//.replace(/^https?:\/\/[^/]+/, "");
        const path       = MODEL.get("path");

        return {
            method : httpMethod,
            path   : path,
            url    : baseURL + path,
            query  : generateRequestQuery(),
            body   : generateRequestPayload(),
            headers: generateHTTPHeaders()
        };
    }

    function generateHTTPHeaders()
    {
        const httpMethod = MODEL.get("httpMethod");
        const headers = {
            accept: "application/fhir+json",
            prefer: "respond-async"
        };

        if (httpMethod == "POST") {
            headers["content-type"] = "application/json";
        }

        return headers;
    }

    function generateRequestQuery()
    {
        const httpMethod = MODEL.get("httpMethod");

        if (httpMethod != "GET") {
            return "";
        }

        const q = new URLSearchParams();

        // _since --------------------------------------------------------------
        const _since = MODEL.get("_since");
        if (_since) {
            q.append("_since", _since);
        }

        // _type ---------------------------------------------------------------
        let allTypes      = [...MODEL.get("resourceCounts")];
        let selectedTypes = [...MODEL.get("selectedTypes")];

        if (MODEL.get("exportType") != "system") {
            allTypes = allTypes.filter(x => x.name != "Group" && x.name != "Practitioner" && x.name != "Organization");
            selectedTypes = selectedTypes.filter(x => x != "Group" && x != "Practitioner" && x != "Organization");
        }
        const allLength = allTypes.length;
        const selLength = selectedTypes.length;
        if (selLength && selLength != allLength) {
            q.append("_type", selectedTypes.join(","));
        }

        // _elements -----------------------------------------------------------
        const _elements = MODEL.get("_elements");
        if (_elements) {
            q.append("_elements", _elements);
        }

        return q.toString();
    }

    function generateRequestPayload()
    {
        const httpMethod = MODEL.get("httpMethod");

        if (httpMethod != "POST") {
            return null;
        }

        const payload = {
            resourceType: "Parameters",
            parameter: []
        };

        // _since --------------------------------------------------------------
        const _since = MODEL.get("_since");
        if (_since) {
            payload.parameter.push({
                name: "_since",
                valueInstant: _since
            });
        }

        // _type ---------------------------------------------------------------
        let allTypes      = [...MODEL.get("resourceCounts")];
        let selectedTypes = [...MODEL.get("selectedTypes")];

        if (MODEL.get("exportType") != "system") {
            allTypes = allTypes.filter(x => x.name != "Group" && x.name != "Practitioner" && x.name != "Organization");
            selectedTypes = selectedTypes.filter(x => x != "Group" && x != "Practitioner" && x != "Organization");
        }
        const allLength = allTypes.length;
        const selLength = selectedTypes.length;
        if (selLength && selLength != allLength) {
            payload.parameter = payload.parameter.concat(
                selectedTypes.map(t => ({
                    name: "_type",
                    valueString: t
                }))
            );
        }

        // _elements -----------------------------------------------------------
        const _elements = MODEL.get("_elements");
        if (_elements) {
            payload.parameter.push({
                name: "_elements",
                valueString: _elements
            });
        }

        // patient -------------------------------------------------------------
        // if (MODEL.get("exportType") != "system") {
            MODEL.get("selectedPatients").forEach(id => {
                payload.parameter.push({
                    name: "patient",
                    valueReference: {
                        reference: `Patient/${id}`
                    }
                });
            });
        // }

        return payload;
    }

    function togglePatient(id, selected)
    {
        const array = [...MODEL.get("selectedPatients")];
        const index = array.indexOf(id);
        if (selected) {
            if (index == -1) {
                array.push(id);
                MODEL.set("selectedPatients", array);
            }
        } else {
            if (index > -1) {
                array.splice(index, 1);
                MODEL.set("selectedPatients", array);
            }
        }
    }

    function toggleType(id, selected)
    {
        const array = [...MODEL.get("selectedTypes")];
        const index = array.indexOf(id);
        if (selected) {
            if (index == -1) {
                array.push(id);
                MODEL.set("selectedTypes", array);
            }
        } else {
            if (index > -1) {
                array.splice(index, 1);
                MODEL.set("selectedTypes", array);
            }
        }
    }

    function getAjaxError(xhr, prefix = "")
    {
        let message = prefix;
        if (xhr.responseJSON) { // XHR with JSON response
            message += JSON.stringify(xhr.responseJSON, null, 4);
        }
        else if (xhr.status && xhr.statusText) { // XHR error
            message += xhr.status + " " + xhr.statusText;
        }
        else {
            message += "unknown error";
        }
        return message;
    }

    function cancelExport()
    {
        return new Promise(resolve => {
            const statusUrl = MODEL.get("statusUrl");

            if (!statusUrl) {
                return resolve();
            }

            MODEL.set({
                progressMessage : "Canceling previous export...",
                progressDuration: 0.2,
                progressValue   : 0,
                progressVisible : true,
                statusUrl       : ""
            });

            $.ajax({
                url: statusUrl,
                method: "DELETE"
            }).always(() => {
                MODEL.set({
                    progressMessage: "Canceled previous export",
                    progressValue  : 100
                });
                setTimeout(() => {
                    MODEL.set({
                        progressVisible: false,
                        files          : null,
                        deletedFiles   : null,
                        fileErrors     : null
                    });
                    resolve();
                }, 600);
            });
        });
    }

    function prepareDownload()
    {
        return cancelExport().then(() => {
            MODEL.set({
                error           : "",
                progressDuration: 0,
                progressValue   : 0,
                progressMessage : "Starting the kick-off request...",
                progressVisible : true
            });

            const { method, url, query, headers, body } = generateHTTPRequest();

            return $.ajax({
                url: url + (query ? "?" + query : ""),
                method,
                headers,
                data: method == "POST" ? JSON.stringify(body) : undefined
            }).then(function(body, resultCode, xhr) {
                
                // Accepted
                if (xhr.status == 202) {
                    MODEL.set({
                        statusUrl: xhr.getResponseHeader("content-location"),
                        progressMessage: "Preparing files. Please wait...",
                    });
                    waitForFiles();
                }

                // No Content
                else if (xhr.status == 204) {
                    MODEL.set({
                        progressVisible : false,
                        files           : null,
                        deletedFiles    : null,
                        fileErrors      : null
                    });
                }

                else {
                    MODEL.set({
                        error: getAjaxError(xhr, `Requesting '${url}' returned: `),
                        progressDuration: 0,
                        progressValue   : 0,
                        progressMessage : "",
                        progressVisible : false
                    });
                }
            }, xhr => {
                MODEL.set({
                    error: getAjaxError(xhr, `Requesting '${url}' returned: `),
                    progressDuration: 0,
                    progressValue   : 0,
                    progressMessage : "",
                    progressVisible : false
                });
            });
        });
    }

    function waitForFiles() {
        const url = MODEL.get("statusUrl");
        $.ajax({ url }).then(function(body, resultCode, xhr) {
            var dur = uInt(xhr.getResponseHeader("retry-after"));

            if (xhr.status == 200) {
                
                if (dur) {
                    MODEL.set("progressDuration", 0);
                    MODEL.set("progressValue", 100);
                    if (TIMER) clearTimeout(TIMER);
                    TIMER = setTimeout(function() {
                        MODEL.set({
                            progressVisible : false,
                            files           : body.output,
                            deletedFiles    : body.deleted,
                            fileErrors      : body.error,
                            inTransientError: false
                        });
                    }, 100);
                } else {
                    MODEL.set({
                        progressVisible : false,
                        files           : body.output,
                        deletedFiles    : body.deleted,
                        fileErrors      : body.error,
                        inTransientError: false
                    });
                }
            }
            else if (xhr.status == 202) {
                var pct = parseInt(xhr.getResponseHeader("x-progress"), 10);
                if (!isNaN(pct) && isFinite(pct)) {
                    MODEL.set("progressDuration", dur);
                    MODEL.set("progressValue", 100);
                    if (pct < 100) {
                        if (TIMER) clearTimeout(TIMER);
                        TIMER = setTimeout(function() {
                            waitForFiles();
                        }, dur * 1000);
                    }
                }
            }
            else {
                MODEL.set("progressDuration", 0);
                MODEL.set("progressValue", 100);
                MODEL.set("error", getAjaxError(xhr, `Requesting '${url}' returned: `));
            }
        }, xhr => {
            MODEL.set("error", getAjaxError(xhr, `Requesting '${url}' returned: `));
            try {
                if (xhr.responseJSON.issue[0].code == "transient") {
                    MODEL.set("inTransientError", true);
                }
            } catch {}
        });
    }

    function copyToClipboard(e)
    {
        var code = $("#request-code")[0];
        const selection = window.getSelection();
        const range = document.createRange();
        selection.removeAllRanges();
        range.selectNodeContents(code);
        selection.addRange(range);
        document.execCommand('copy');
        selection.removeAllRanges();
    }

    function main()
    {
        const QUERY   = Lib.getUrlQuery({ camelCaseKeys: true });
        const PARAMS  = getHiddenParams(QUERY.server);
        const baseURL = QUERY.server//new URL(QUERY.server).pathname;

        // Debug events? Do this first if needed
        if (Lib.bool(QUERY.debug)) {
            MODEL.on("change", e => console.log("STATE:", e.type, e.data));
        }

        // ---------------------------------------------------------------------
        // Bindings
        // ---------------------------------------------------------------------

        // Display the FHIR version when it changes. Currently only happens once on load
        MODEL.on("change:fhirVersion", e => renderFHIRVersion(e.data.newValue));

        // Display the group selector. Currently only happens once on load
        MODEL.on("change:groups", e => renderGroupSelector(e.data.newValue));

        // Display the patient selector. Happens once on load and later when the
        // selected group is changing
        MODEL.on("change:patients", e => renderPatientCheckboxes(e.data.newValue));

        // When we have the list of available resources and their counts render
        // the resourceType selector. Happens once on load
        MODEL.on("change:resourceCounts", e => renderResourceCheckboxes(e.data.newValue));

        // Render the download links (files) that we receive after pooling the
        // status endpoint
        MODEL.on("change:files", e => renderFiles(e.data.newValue));

        // Render the download links for deleted files (if any)
        MODEL.on("change:deletedFiles", e => renderDeletedFiles(e.data.newValue));

        // Render the download errors (files) that we receive after pooling the
        // status endpoint
        MODEL.on("change:fileErrors", e => renderFileErrors(e.data.newValue));

        // When the selected patients change
        MODEL.on("change:selectedPatients", onSelectedPatientsChange);

        // When the exportType changes (patient or system)
        MODEL.on("change:exportType", onExportTypeChange);

        // When the selected group changes (or is emptied)
        MODEL.on("change:group", onGroupChange);
        MODEL.on("change:group change:exportType", onExportTypeOrGroupChange);
        MODEL.on("change:error", onErrorChange);
        MODEL.on("change:progressVisible", onProgressToggle);
        MODEL.on("change:progressDuration", e => $(".progress-bar").css("transitionDuration", (e.data.newValue || 0) + "s"));
        MODEL.on("change:progressValue", e => $(".progress-bar").css("width", e.data.newValue + "%"));
        MODEL.on("change:progressMessage", e => $(".preparing-progress label").text(e.data.newValue));
        MODEL.on("change:statusUrl", onStatusUrlChange);
        MODEL.on("change:codeType", onCodeTypeChange);
        MODEL.on("change:inTransientError", onTransientErrorChange);
        MODEL.on("change:selectedPatients change:exportType change:group change:_elements change:_since", () => MODEL.set("inTransientError", false));
        MODEL.on("change", renderHTTPRequest);


        $("#start").on("change", e => MODEL.set("_since", e.target.value));
        $("#group").on("change", e => MODEL.set("group", e.target.value));
        $(document).on("change", '[name="patient"]', e => togglePatient(e.target.value, e.target.checked));
        $(document).on("change", '[name="type"]', e => toggleType(e.target.value, e.target.checked));
        $(document).on("change", '[name="export-type"]', e => MODEL.set("exportType", e.target.value));
        $(document).on("change", '[name="code-type"]', e => MODEL.set("codeType", e.target.value));
        $("#show-request").on("change", e => MODEL.set("showRequest", e.target.checked));
        $("#_elements").on("input change", e => MODEL.set("_elements", e.target.value.split(",").map(x => x.trim()).filter(Boolean).join(",")));
        $("form").on("submit", onFormSubmit);
        $("#delete-export, #cancel-btn").on("click", cancelExport);
        $(".copy-btn").on("click", copyToClipboard);

        // INIT ----------------------------------------------------------------
        renderSinceSelector();
        MODEL.set("fhirVersion", PARAMS.stu);
        MODEL.set("baseURL", baseURL);
        MODEL.set("codeType", "http");
        

        $.get(baseURL + "/$get-resource-counts").then(
            resources => {
                MODEL.set({
                    resourceCounts: resources.parameter,
                    exportType    : "patient",
                    selectedTypes : resources.parameter.map(x => x.name)
                });
            },
            xhr => MODEL.set("error", getAjaxError(xhr, "Requesting '/$get-resource-counts' returned: "))
        );

        $.get(baseURL + "/Group").then(
            groups => MODEL.set("groups", groups.entry),
            xhr => MODEL.set("error", getAjaxError(xhr, "Requesting '/Groups' returned: "))
        );

        $.get(baseURL + "/$get-patients").then(
            patients => MODEL.set({
                patients: patients,
                selectedPatients: []
            }),
            xhr => MODEL.set("error", getAjaxError(xhr, "Requesting '/$get-patients' returned: "))
        );
    }

    $(main);
    
// @ts-ignore
})(jQuery, Lib, moment, Prism);
