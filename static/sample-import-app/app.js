jQuery(function($) {

    const fhirVersionLabels = {
        4: "R4",
        3: "STU3",
        2: "DSTU2"
    };

    let TIMER;

    // STATE (Models) ----------------------------------------------------------
    const STATE = new Lib.Model({
        inputSource: undefined,
        storageDetail: undefined,
        files: undefined,
        codePreviewType: "none",
        fhirVersion: undefined,
        backendUrl: undefined,
        progress: undefined,
        progressDuration: 0,
        result: undefined,
        activeTab: "form" // "form" or "results"
    });

    const VALIDATION = new Lib.Model({ files: [] });

    // Rendering functions (Views) ---------------------------------------------
    const DOM = {
        rowTemplate       : $("#rowInput"),
        formInputFiles    : $('#uploads tbody'),
        appendButton      : $("#append-button"),
        httpHeaders       : $('#http-headers'),
        httpBody          : $('#http-body'),
        curlCode          : $('#curl-code'),
        copyButton        : $('.copy-to-clipboard'),
        inputSource       : $("input[name='source']"),
        codePreviewButtons: $('#code-preview .btn'),
        storageDetail     : $("select[name='storage-protocol']"),
        uploadButton      : $("#upload-button"),
        form              : $("form"),
        fhirSelector      : $("#fhir-selector"),
        goBackButton      : $(".go-back"),
        tabs              : $('a[data-toggle="tab"]'),
        errorCloseBtn     : $("#global-error .close"),
        cancelBtn         : $("#cancel-btn")
    };

    function renderFiles() {
        const rows  = DOM.formInputFiles.find("tr.import-file");
        const files = STATE.get("files");

        if (!files.length) {
            return DOM.formInputFiles.html(`<tr><th class="bg-warning"></th><th class="text-warning bg-warning" style="font-style:italic;font-weight:normal" colspan="3">No data sources specified</th></tr>`);
        }

        // Full re-render on add/remove
        if (files.length != rows.length) {
            DOM.formInputFiles.empty();
            files.forEach((file, i, all) => {
                const row = $(DOM.rowTemplate.html());
                row.find("input").eq(0).val(file.url || "");
                row.find("input").eq(1).val(file.type || "");
                row.find(".btn-remove").prop("disabled", all.length < 2);
                DOM.formInputFiles.append(row);
            });
            // If a row was added, focus its url field
            if (files.length > rows.length) {
                DOM.formInputFiles.find("tr.import-file").last().find("input").first().focus();
            }
        }

        // Just update values otherwise. This is not even needed because those
        // values only change after user input. It is however nice to have if we
        // decide to modify the model data and have it automatically render in
        // the UI.
        else {
            files.forEach((file, i, all) => {
                const row = rows.eq(i);
                row.find("input").eq(0).val(file.url || "");
                row.find("input").eq(1).val(file.type || "");
            });
        }
    }

    function renderCodePreviews() {
        DOM.httpHeaders.text(generateHTTPHeaders());
        DOM.httpBody.text(generateHTTPBody());
        DOM.curlCode.text(generateCurlCommand());
        Prism.highlightAll();
    }

    function toggleCodePreviews() {
        const cur = STATE.get("codePreviewType");
        DOM.codePreviewButtons.each((i, b) => {
            const val = $(b).data("value");
            $(b).toggleClass("active", val === cur);
            $('#request-' + val).toggle(val === cur);
        })
    }

    function copyToClipboard(e) {
        var code = $(e.delegateTarget).siblings("pre")[0];
        const selection = window.getSelection();
        const range = document.createRange();
        selection.removeAllRanges();
        range.selectNodeContents(code);
        selection.addRange(range);
        document.execCommand('copy');
        selection.removeAllRanges();
    }

    function renderFileErrors() {
        const errors = VALIDATION.get("files") || [];

        errors.forEach((e, i) => {
            let input1 = DOM.formInputFiles.find("tr").eq(i).find("input:first");
            let input2 = DOM.formInputFiles.find("tr").eq(i).find("input:last");
            input1.attr("title", e.url || null).parent().toggleClass("has-error", !!e.url);
            input2.attr("title", e.type || null).parent().toggleClass("has-error", !!e.type);
            input1.closest("tr").find('.validity')
                .toggleClass('fa-times-circle text-danger', Boolean(e.url || e.type))
                .toggleClass('fa-check-circle text-success', Boolean(!e.url && !e.type));
        });
    }

    function renderInputSourceErrors(e) {
        DOM.inputSource.attr("title", e.data.newValue)
            .parent().toggleClass("has-error", !!e.data.newValue);
    }

    function renderResults() {
        const outcome = STATE.get("result");

        // Show tabs after the first import attempt
        if (outcome !== undefined) {
            $('.nav-tabs').removeClass("hidden");
        }

        if (!outcome) {
            $("#success-result").hide();
            return;
        }

        const files = STATE.get("files");

        $("#success-result").show().find("tbody").empty();

        outcome.output.forEach(file => {
            const matchingInput = files.find(i => i.url === file.inputUrl);
            const resourceType = matchingInput ? matchingInput.type : "-";
            $(".file-list tbody").append(`
                <tr>
                    <td class="text-center"><i class="fa fa-check-circle text-success"></i></td>
                    <td>${truncateUrl(file.inputUrl)}</td>
                    <td>${resourceType}</td>
                    <td>${file.count}</td>
                    <td><a href="${file.url}" target="_blank" rel="noopener noreferrer">Outcome details</a></td>
                </tr>
            `);
        });

        outcome.error.forEach(file => {
            const matchingInput = files.find(i => i.url === file.inputUrl);
            const resourceType = matchingInput ? matchingInput.type : "-";
            $(".file-list tbody").append(`
                <tr class="text-danger error-item">
                    <td class="text-center"><i class="fa fa-times-circle text-danger"></i></td>
                    <td>${truncateUrl(file.inputUrl)}</td>
                    <td>${resourceType}</td>
                    <td>${file.count}</td>
                    <td><a class="text-danger" href="${file.url}" target="_blank" rel="noopener noreferrer">Outcome details</a></td>
                </tr>
            `);
            const errorMsg = extractParam(file.url, "message") || "Unknown problem";
            $(".file-list tbody").append(`
                <tr class="text-danger error-detail">
                    <td></td>
                    <td colspan="5" class="text-danger small"><em>${errorMsg}</em></td>
                </tr>`
            );
        });

        $("#success-result .panel")
            .toggleClass("panel-warning", !!(outcome.error.length && outcome.output.length ))
            .toggleClass("panel-danger" , !!(outcome.error.length && !outcome.output.length))
            .toggleClass("panel-success", !!(!outcome.error.length && outcome.output.length));
        
        $("#result-description b").text(
            outcome.error.length ?
                outcome.output.length ?
                    "Problems encountered importing some files" :
                    "No files were imported" :
                "All files successfully imported"
            );
    }


    // Event handlers ----------------------------------------------------------
    function onFileInputChange(e) {
        const files = [...STATE.get("files")];
        const row   = $(e.target).closest("tr");
        const index = DOM.formInputFiles.find("tr").index(row);
        files[index] = {
            ...files[index],
            [e.target.name == "url" ? "url" : "type"]: e.target.value
        };
        STATE.set("files", files);
    }

    function onFileRemove(e) {
        let files = [...STATE.get("files")];
        const row   = $(e.target).closest("tr");
        const index = DOM.formInputFiles.find("tr").index(row);
        files.splice(index, 1);
        STATE.set("files", files);
    }

    function onFileAdd() {
        STATE.set("files", [...STATE.get("files"), { url: "", type: ""}]);
    }

    function onCodePreviewClick(e) {
        const cur = STATE.get("codePreviewType");
        const btn = $(e.target).closest(".btn");
        const value = btn.data("value");
        STATE.set("codePreviewType", value == cur ? "none" : value);
    }

    function onFhirVersionSelect(e) {
        e.preventDefault();
        const $a = $(e.target).closest("a");
        const value = $a.data("value");
        STATE.set("fhirVersion", value + "");
    }

    function onFhirVersionChanged(e) {

        // Update backendUrl and backendFullUrl
        const path = "/" + Lib.base64UrlEncode(
            JSON.stringify({ stu: e.data.newValue })
        ) + "/fhir/$import";
        STATE.set("backendUrl", path);
        STATE.set("backendFullUrl", location.origin + path);

        // Persist the change in the browser location
        let url = new URL(location.href);
        url.searchParams.set("stu", e.data.newValue);
        window.history.replaceState({}, document.title, url.href);

        // Update the version selector UI
        DOM.fhirSelector.find("b").text(fhirVersionLabels[e.data.newValue]);

        // bind resourceType inputs to the appropriate list
        DOM.form.find(".file-type").attr("list", `fhir-resource-types-r${e.data.newValue}`);
    }

    function onSubmit(e) {
        e.preventDefault();
        if (!isValid()) {
            return;
        }

        $.ajax({
            url: STATE.get("backendFullUrl"),
            type: "POST",
            dataType: "json",
            headers: {
                Accept: "application/fhir+json",
                Prefer: "respond-async",
            },
            data: JSON.stringify(generateRequestPayload()),
            contentType: "application/json"
        })
        .done((data, textStatus, xhr) => {
            if (xhr.status == 202 || xhr.status == 200) {
                onImportAccepted(xhr);
            }
            else {
                STATE.set("error", getErrorText(xhr));
            }
        })
        .fail(xhr => {
            STATE.set("error", getErrorText(xhr));
        });
    }

    function onImportAccepted(xhr) {
        STATE.set({
            progressDuration: 0,
            progress: 0,
            result: null,
            activeTab: "results",
            statusUrl: xhr.getResponseHeader("content-location"),
            error: null
        });
        pollForStatus();
    }

    function onProgress(e) {
        const progress = e.data.newValue;
        if (progress < 0) {
            $("#preparing-progress").hide();
        }
        else if (progress >= 100) {
            setTimeout(
                () => { $("#preparing-progress").hide(); },
                400
            );
        }
        else {
            $("#preparing-progress").show();
        }
        $(".progress-bar").css("width", progress + "%");
        DOM.cancelBtn.prop("disabled", progress <= 0 || progress >= 100);
    }

    function onValidationToggle(e) {
        if (e.data.newValue) {
            STATE.on("change:storageDetail change:inputSource change:files change:fhirVersion", validate);
        } else {
            STATE.off("change:storageDetail change:inputSource change:files change:fhirVersion", validate);
        }
    }

    function onError() {
        const error = STATE.get("error");
        $("#global-error").toggleClass("hidden", !error).find("> .message").text(error || "");
    }

    function onTabChanged(e) {
        STATE.set("activeTab", e.target.getAttribute("href").replace("#", ""));
    }

    // Other Functions ---------------------------------------------------------
    function generateRequestPayload() {
        return {
            inputFormat: "application/fhir+ndjson",
            inputSource: STATE.get("inputSource"),
            storageDetail: {
                type: STATE.get("storageDetail")
            },
            input: STATE.get("files")
        };
    }

    function generateHTTPHeaders() {
        return (
            "POST " + STATE.get("backendUrl") + "\n" +
            "Host: " + location.host + "\n" +
            "Content-Type: application/json\n" +
            "Accept: application/fhir+json\n" +
            "Prefer: respond-async\n"
        );
    }

    function generateHTTPBody() {
        return JSON.stringify(generateRequestPayload(), null, 4);
    }

    function generateCurlCommand() {
        const command = ["curl -v"];
        const options = [
            "-H 'Content-Type: application/json'",
            "-H 'Accept: application/fhir+json'",
            "-H 'Prefer: respond-async'",
        ];
        const data = `-d '${JSON.stringify(generateRequestPayload(), null, 4)}'`;
        command.push(options.join(" "));
        command.push(data);
        command.push("'" + STATE.get("backendFullUrl") + "'");
        return command.join(" ");
    }

    function validate()
    {
        const inputSource = STATE.get("inputSource");
        if (!inputSource) {
            VALIDATION.set("inputSource", "The data origin is required");
        }
        else if (!inputSource.match(/^https?\:\/\/.+/)) {
            VALIDATION.set("inputSource", "The data origin must be url");
        }
        else {
            VALIDATION.set("inputSource", null);
        }

        const files = STATE.get("files");
        const fileErrors = files.map(() => ({ url: null, type: null }));
        files.forEach((f, i) => {
            if (!f.url) {
                fileErrors[i].url = "File url is required";
            }
            else if (!f.url.match(/^https?\:\/\/.+/)) {
                fileErrors[i].url = "File url must be an URL";
            }

            if (!f.type) {
                fileErrors[i].type = "File type is required";
            }
        });
        VALIDATION.set("files", fileErrors);
    }

    function isValid() {
        const files = VALIDATION.get("files");

        if (!files || !files.length) {
            return false;
        }

        return VALIDATION.get("inputSource") === null && files.every(f => {
            return !f.url && !f.type;
        });
    }

    function pollForStatus() {
        const url = STATE.get("statusUrl");
        if (!url) {
            return STATE.set("error", "No status URL");
        }

        $.ajax({
            url: url,
            headers: {
                Accept: "application/json"
            }
        }).done(function(body, resultCode, xhr) {
            if (xhr.status == 200) {
                STATE.set("progressDuration", 400);
                requestAnimationFrame(() => {
                    STATE.set("progress", 100);
                    TIMER = setTimeout(() => {
                        STATE.set("result", body);
                    }, 500)
                })
            }
            else if (xhr.status == 202) {
                const progress  = parseFloat(xhr.getResponseHeader("x-progress"));
                const retryTime = xhr.getResponseHeader("retry-after");
                const progressDuration = Math.max(+retryTime || 200, 0);
                const retryAfter = Math.max(progressDuration - 20, 0);
                
                STATE.set({ progressDuration });
                requestAnimationFrame(() => {
                    STATE.set({ progress });
                    TIMER = setTimeout(pollForStatus, retryAfter);
                })
            }
            else {
                STATE.set("error", getErrorText(xhr));
            }
        }).fail(xhr => {
            if (xhr.responseJSON) {
                STATE.set({
                    progressDuration: 0,
                    progress: 100,
                    result: xhr.responseJSON
                });
            } else {
                STATE.set("error", getErrorText(xhr));
            }
        });
    }

    function extractParam(url, param) {
        return new URL(url + "").searchParams.get(param);
    }

    function truncateUrl(url) {
        if (url.length < 2) {
            return `<span title="${url}>${url}</span>`;
        }
        let middle = Math.floor(url.length / 2);
        return (`
            <span class=truncated title=${url}
                  data-content-start=${url.substr(0,middle)}
                  data-content-end=${url.substr(middle)}
            ></span>
        `);
    }

    function getErrorText(error) {
        var txt = "Unknown error";
        if (error instanceof Error) {
            txt = String(error);
        }
        else if (error.responseJSON) { // XHR with JSON response
            if (error.responseJSON.resourceType === "OperationOutcome") {
                txt = error.responseJSON.issue.map(i => (
                    `${i.code} ${i.severity}: ${i.diagnostics}`
                )).join("\n");
            }
            else {
                txt = JSON.stringify(error.responseJSON, null, 4);
            }
        }
        else if (error && typeof error == "object") { // XHR with JSON response
            if (error.resourceType === "OperationOutcome") {
                txt = error.issue.map(i => (
                    `${i.code} ${i.severity}: ${i.diagnostics}`
                )).join("\n");
            }
            else {
                txt = JSON.stringify(error, null, 4);
            }
        }
        else if (error.status && error.statusText) { // XHR error
            txt = error.status + ": " + error.statusText;
        }
        else {
            console.log(txt + ": ", arguments);
        }
        return txt;
    }

    function cancelImport() {
        if (TIMER) {
            clearTimeout(TIMER);
        }
        const url = STATE.get("statusUrl");
        if (url) {
            $.ajax({ url, type: 'DELETE' })
            .done((body, resultCode, xhr) => {
                STATE.set({
                    error: getErrorText(xhr),
                    progress: 0,
                    activeTab: "form",
                    statusUrl: null
                });
            })
            .fail(xhr => {
                STATE.set("error", getErrorText(xhr));
            });
        }
    }

    
    // -------------------------------------------------------------------------
    // Bindings
    // -------------------------------------------------------------------------

    // Debug events? Do this first if needed
    if (Lib.bool(extractParam(location.href, "debug"))) {
        STATE.on("change",      e => console.log("     STATE:", e.type, e.data));
        VALIDATION.on("change", e => console.log("VALIDATION:", e.type, e.data));
    }

    // Update UI based on data changes
    STATE.on("change:files", renderFiles);
    STATE.on("change:fhirVersion", onFhirVersionChanged);
    STATE.on("change:storageDetail change:inputSource change:files change:fhirVersion change:codePreviewType", renderCodePreviews);
    STATE.on("change:codePreviewType", toggleCodePreviews);
    STATE.on("change:storageDetail", e => DOM.storageDetail.val(e.data.newValue));
    STATE.on("change:inputSource", e => DOM.inputSource.val(e.data.newValue));
    STATE.on("change:progress", onProgress);
    STATE.on("change:progressDuration", e => $(".progress-bar").css("transitionDuration", e.data.newValue + "ms"));
    STATE.on("change:result", renderResults);
    STATE.on("change:activeTab", e => $("#" + e.data.newValue + "-tab").tab("show"));
    STATE.on("change:validation", onValidationToggle);
    STATE.on("change:error", onError);
    VALIDATION.on("change:inputSource", renderInputSourceErrors);
    VALIDATION.on("change:files", renderFileErrors);
    VALIDATION.on("change", () => DOM.uploadButton.prop("disabled", !isValid()));

    // Update models based on user interactions
    DOM.formInputFiles.on("input", "input", onFileInputChange);
    DOM.formInputFiles.on("click", ".btn-remove", onFileRemove);
    DOM.appendButton.on("click", onFileAdd);
    DOM.codePreviewButtons.on('click', onCodePreviewClick);
    DOM.copyButton.on("click", copyToClipboard);
    DOM.storageDetail.on("change", e => STATE.set("storageDetail", e.target.value));
    DOM.inputSource.on("input", e => STATE.set("inputSource", e.target.value));
    DOM.form.on("submit", onSubmit);
    DOM.fhirSelector.on("click", "a", onFhirVersionSelect);
    DOM.goBackButton.on("click", () => STATE.set("activeTab", "form"));
    DOM.tabs.on('shown.bs.tab', onTabChanged);
    DOM.errorCloseBtn.on("click", () => STATE.set("error", null));
    DOM.cancelBtn.on("click", cancelImport);

    // -------------------------------------------------------------------------
    // Init
    // -------------------------------------------------------------------------
    var stuFromUrl = extractParam(location.href, "stu");
    STATE.set({
        files: [
            // { url: "https://raw.githubusercontent.com/smart-on-fhir/flat-fhir-files/master/r3/Observation.ndjson", type: "Observation" },
            // { url: "https://raw.githubusercontent.com/smart-on-fhir/flat-fhir-files/master/r3/Patient.ndjson"    , type: "Patient" },
            // { url: "https://raw.githubusercontent.com/smart-on-fhir/flat-fhir-files/master/r3/Immunization.ndjson"    , type: "Immunization" },
            // { url: "https://storage.googleapis.com/sandbox_bulk_data_r3/Condition.ndjson", type: "Immunization" }
        ],
        storageDetail: "https", // Default to https
        inputSource  : "", // Clear autofill (if any)
        fhirVersion  : fhirVersionLabels[stuFromUrl] ? stuFromUrl : "4",
        validation   : true
    });
    $('[data-toggle="tooltip"]').tooltip({ container: "body", placement: "auto bottom" });
});
