jQuery(function($) {

    const fhirVersionLabels = {
        4: "R4",
        3: "STU3",
        2: "DSTU2"
    };

    // STATE (Models) -----------------------------------------------------------
    const STATE = new Lib.Model({
        // inputSource: undefined,
        // storageDetail: undefined,
        // files: [],
        // codePreviewType: "none",
        // fhirVersion: undefined,
        // backendUrl: undefined,
        // progress: undefined,
        // progressDuration: 0,
        // result: undefined,
        // activeTab: "form" // "form" or "results"
    });

    const ERROR_STATE = new Lib.Model();

    // Rendering functions (Views) ---------------------------------------------
    const DOM = {
        rowTemplate       : $("#rowInput"),
        formInputFiles    : $('#uploads tbody'),
        appendButton      : $("#append-button"),
        httpCode          : $('#request-http pre'),
        curlCode          : $('#request-curl pre'),
        inputSource       : $("input[name='source']"),
        codePreviewButtons: $('#code-preview .btn'),
        storageDetail     : $("select[name='storage-protocol']"),
        uploadButton      : $("#upload-button"),
        form              : $("form"),
        fhirSelector      : $("#fhir-selector"),
        goBackButton      : $(".go-back")
    };

    function renderFiles() {
        const rows  = DOM.formInputFiles.find("tr");
        const files = STATE.get("files");

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
        DOM.httpCode.text(generateHTTPCode());
        DOM.curlCode.text(generateCurlCommand());
    }

    function toggleCodePreviews(e) {
        const cur = STATE.get("codePreviewType");
        DOM.codePreviewButtons.each((i, b) => {
            const val = $(b).data("value");
            $(b).toggleClass("active", val === cur);
            $('#request-' + val).toggle(val === cur);
        })
    }

    function renderFileErrors() {
        const errors = ERROR_STATE.get("files") || [];

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

    function renderImportErrors() {
        console.error(arguments)
    }

    function renderResults() {
        const outcome = STATE.get("result");

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
                    <td><span title="${file.inputUrl}">${truncateUrl(file.inputUrl)}</span></td>
                    <td>${resourceType}</td>
                    <td>${file.count}</td>
                    <td><a href="${file.url}" target="_blank" rel="noopener noreferrer">Outcome details</a></td>
                </tr>
            `);
        });

        if (outcome.error && outcome.error.length) {
            $("#success-result .panel").addClass("panel-warning").removeClass("panel-success");
            $("#result-description b").text("Problems encountered importing some files")
            outcome.error.forEach(file => {
                const matchingInput = files.find(i => i.url === file.inputUrl);
                const resourceType = matchingInput ? matchingInput.type : "-";
                $(".file-list tbody").append(`
                    <tr class="text-danger error-item">
                        <td class="text-center"><i class="fa fa-times-circle text-danger"></i></td>
                        <td><span title="${file.inputUrl}">${truncateUrl(file.inputUrl)}</span></td>
                        <td>${resourceType}</td>
                        <td>${file.count}</td>
                        <td><a class="text-warning" href="${file.url}" target="_blank" rel="noopener noreferrer">Outcome details</a></td>
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
        } else {
            $("#result-description b").text("All files successfully imported");
            $("#success-result .panel").removeClass("panel-warning").addClass("panel-success");
        }
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
        STATE.set("fhirVersion", value);
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

        $('.nav-tabs').removeClass("hidden")
        // $("#results-tab").tab("show");
        $("#success-result").removeClass("hidden");
        $("#preparing-progress").removeClass("hidden");
        STATE.set("progressDuration", 0);
        STATE.set("progress", 0);
        STATE.set("result", null);
        
        $.ajax({
            url: STATE.get("backendFullUrl"),
            type: "POST",
            dataType: "application/fhir+json",
            headers: {
                Accept: "application/fhir+json",
                Prefer: "respond-async",
            },
            data: JSON.stringify(generateRequestPayload()),
            contentType: "application/json",
        })
        .always(xhr => {
            if (xhr.status == 202 || xhr.status == 200) {
                onImportAccepted(xhr);
            }
            else {
                onImportRejected(xhr);
            }
        });
    }

    function onImportAccepted(xhr) {
        STATE.set("activeTab", "results");
        STATE.set("progressDuration", 0);
        STATE.set("progress", 0);
        STATE.set("result", null);
        pollForStatus(xhr.getResponseHeader("content-location"));
    }

    function onImportRejected(xhr) {
        // show error somehow
    }

    function onProgress(e) {
        const progress = e.data.newValue;
        $("#preparing-progress")[progress > 0 && progress < 100 ? "show" : "hide"]();
        $(".progress-bar").css("width", progress + "%");
        $("#cancel-btn").prop("disabled", progress <= 0 || progress >= 100);
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

    function generateHTTPCode() {
        return (
            "POST " + STATE.get("backendUrl") + "\n" +
            "Host: " + location.host + "\n" +
            "Content-Type: application/json\n" +
            "Accept: application/fhir+json\n" +
            "Prefer: respond-async\n\n" +
            JSON.stringify(generateRequestPayload(), null, 4)
        );
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
            ERROR_STATE.set("inputSource", "The data origin is required");
        }
        else if (!inputSource.match(/^https?\:\/\/.+/)) {
            ERROR_STATE.set("inputSource", "The data origin must be url");
        }
        else {
            ERROR_STATE.set("inputSource", null);
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
            else {
                fileErrors[i].url = null;
            }

            if (!f.type) {
                fileErrors[i].type = "File type is required";
            }
            else {
                fileErrors[i].type = null;
            }
        });
        ERROR_STATE.set("files", fileErrors);
    }

    function isValid() {
        return ERROR_STATE.get("inputSource") === null &&
        (ERROR_STATE.get("files") || []).every(f => {
            return !f.url && !f.type;
        });
    }

    function pollForStatus(url) {
        $.ajax({
            url: url,
            headers: {
                Accept: "application/json"
            }
        }).then(function(body, resultCode, xhr) {
            if (xhr.status == 200) {
                STATE.set("progressDuration", 0);
                STATE.set("progress", 100);
                STATE.set("result", body);
            }
            else if (xhr.status == 202) {
                const progress  = parseFloat(xhr.getResponseHeader("x-progress"));
                const retryTime = xhr.getResponseHeader("retry-after");
                STATE.set("progressDuration", +retryTime || 200);
                STATE.set("progress", progress);
                setTimeout(() => pollForStatus(url), +retryTime || 200);
            }
        }, renderImportErrors);
    }

    function extractParam(url, param) {
        return new URL(url + "").searchParams.get(param);
    }

    function truncateUrl(url) {
        if (url.length > 50) {
            return url.substr(0,25) + "...." + url.substr(-20);
        }
        return url;
    }

    
    // -------------------------------------------------------------------------
    // Bindings
    // -------------------------------------------------------------------------

    // Debug events?
    if (Lib.bool(extractParam(location.href, "debug"))) {
        STATE.on("change",       e => console.log("      STATE:", e.type, e.data));
        ERROR_STATE.on("change", e => console.log("ERROR_STATE:", e.type, e.data));
    }

    // Update UI based on data changes
    STATE.on("change:files", renderFiles);
    STATE.on("change:storageDetail change:inputSource change:files change:fhirVersion change:codePreviewType", renderCodePreviews);
    STATE.on("change:codePreviewType", toggleCodePreviews);
    STATE.on("change:storageDetail", e => DOM.storageDetail.val(e.data.newValue));
    STATE.on("change:inputSource", e => DOM.inputSource.val(e.data.newValue));
    STATE.on("change:storageDetail change:inputSource change:files change:fhirVersion change:codePreviewType", validate);
    STATE.on("change:fhirVersion", onFhirVersionChanged);
    STATE.on("change:progress", onProgress);
    STATE.on("change:progressDuration", e => $(".progress-bar").css("transitionDuration", e.data.newValue + "ms"));
    STATE.on("change:result", renderResults);
    STATE.on("change:activeTab", e => $("#" + e.data.newValue + "-tab").tab("show"));
    ERROR_STATE.on("change:inputSource", renderInputSourceErrors);
    ERROR_STATE.on("change:files", renderFileErrors);
    ERROR_STATE.on("change", () => DOM.uploadButton.prop("disabled", !isValid()));

    // Update models based on user interactions
    DOM.formInputFiles.on("change input", "input", onFileInputChange);
    DOM.formInputFiles.on("click", ".btn-remove", onFileRemove);
    DOM.appendButton.on("click", onFileAdd);
    DOM.codePreviewButtons.on('click', onCodePreviewClick);
    DOM.storageDetail.on("change", e => STATE.set("storageDetail", e.target.value));
    DOM.inputSource.on("change input", e => STATE.set("inputSource", e.target.value));
    DOM.form.on("submit", onSubmit);
    DOM.fhirSelector.on("click", "a", onFhirVersionSelect);
    DOM.goBackButton.on("click", () => STATE.set("activeTab", "form"));

    // -------------------------------------------------------------------------
    // Init
    // -------------------------------------------------------------------------
    STATE.set("files", [{ url: "", type: ""}]); // Add one empty row
    STATE.set("storageDetail", "https"); // Default to https
    STATE.set("inputSource", ""); // Clear autofill (if any)
    STATE.set("fhirVersion", extractParam(location.href, "stu") || 4);
    $('[data-toggle="tooltip"]').tooltip({ container: "body", placement: "auto bottom" });
});
