// @ts-check
(function($, undefined) {
    var RE_ANY_DASH   = /[_\-]/;
    var RE_FALSE      = /^(0|no|false|off|null|undefined|NaN|)$/i;

    /**
     * Parses the current query string and returns a key/value map of all the
     * parameters.
     * @todo: Handle ampersands 
     * @returns {Object}
     */
    function getUrlQuery(options) {
        options = options || {};
        var q = String(options.queryString || window.location.search)
            .replace(/^\?/, "")/*.replace("&amp;", "&")*/.split("&");
        var out = {};
        $.each(q, function(i, param) {
            if (!param) {
                return true; // continue
            }
            var tokens = param.split('=');
            var key    = tokens[0];
            if (options.camelCaseKeys) {
                key = toCamelCase(key);
            }
            if (key in out) {
                if (!Array.isArray(out[key])) {
                    out[key] = [out[key]];
                }
                out[key].push(decodeURIComponent(tokens[1]));
            }
            else {
                out[key] = decodeURIComponent(tokens[1]);
            }
        });
        return out;
    }

    function bool(x) {
        return !RE_FALSE.test(String(x).trim());
    }

    /**
     * Converts the input string to camelCase. Detects "-" and "_", removes them
     * and converts the following character to upper case. By default this
     * function produces lowerCamelCase (the first letter is in lower case).
     * You can pass true as second argument to make it return UpperCamelCase.
     * @param {String} str Thew string to convert
     * @param {Boolean} [upper]
     * @returns {String}
     */
    function toCamelCase(str, upper) {
        return (str.toLowerCase().split(RE_ANY_DASH).map(function(seg, i) {
            return (!upper && i === 0 ? seg[0] : seg[0].toUpperCase()) + seg.slice(1);
        })).join("");
    }

    function base64UrlUnescape(str) {
        return (str + '==='.slice((str.length + 3) % 4))
            .replace(/-/g, '+')
            .replace(/_/g, '/');
    }

    function base64UrlEscape(str) {
        return str.replace(/\+/g, '-')
            .replace(/\//g, '_')
            .replace(/=/g, '');
    }

    function base64UrlEncode(str) {
        return base64UrlEscape(btoa(str));
    }

    function base64UrlDecode(str) {
        return atob(base64UrlUnescape(str));
    }

    function equals(a, b)
    {
        if (Array.isArray(a)) {
            if (!Array.isArray(b) || a.length !== b.length) {
                return false;
            }
            return a.every((x, i) => equals(x, b[i]));
        }

        if (a && typeof b == "object") {
            if (!b || typeof b != "object") {
                return false;
            }
            if (!equals(Object.keys(a), Object.keys(b))) {
                return false;
            }
            return Object.keys(a).every(key => equals(a[key], b[key]));
        }

        return a === b;
    }

    /**
     * Class Event
     * This is for firing custom events
     * @param {String} type 
     * @param {Object} data 
     */
    function Event(type, data)
    {
        var _isDefaultPrevented = false;
        var _isPropagationStopped = false;

        this.type = type;
        this.data = data;

        this.stopPropagation = function() {
            _isPropagationStopped = true; 
        };

        this.preventDefault = function() {
            _isDefaultPrevented = true; 
        };

        this.isPropagationStopped = function() {
            return _isPropagationStopped; 
        };

        this.isDefaultPrevented = function() {
            return _isDefaultPrevented; 
        };
    }

    /**
     * Class Observable
     * Base class for observable objects
     */
    function Observable()
    {
        this._listeners = {};
        
        /**
         * @param {Event} event
         */
        this.dispatch = function(event) {
            var list = this._listeners[event.type] || [], len = list.length, i;

            for (i = 0; i < len; i += 1) {
                list[i](event);
                if (event.isPropagationStopped()) {
                    break;
                }
            }

            return !event.isDefaultPrevented();
        };

        /**
         * Adds new event listener
         * @param {String} types
         * @param {Function} handler 
         */
        this.on = function(types, handler) {
            var self = this;
            if (!Array.isArray(types)) {
                types = $.trim(String(types || "")).split(/\s+/);
            }
            $.each(types, function(i, type) {
                if (!self._listeners[type]) {
                    self._listeners[type] = [];
                }
                self._listeners[type].push(handler);
            });
        };

        /**
         * Removes event listener
         * @param {string|string[]} type 
         * @param {function} handler 
         */
        this.off = function(type, handler) {

            if (Array.isArray(type)) {
                return type.forEach(t => this.off(t, handler));
            }

            type = String(type).trim();

            if (type.indexOf(" ") > -1) {
                return this.off(type.split(/\s+/), handler)
            }

            if (!type) {
                this._listeners = {};
            }
            else if (!handler) {
                this._listeners[type] = [];
            }
            else {
                this._listeners[type] = (this._listeners[type] || []).filter(
                    function(f) { return f !== handler; }
                );
            }
        }
    }

    /**
     * Class Model
     */
    function Model(data) {

        var _data = data || {};

        Observable.call(this);

        this.dump = function() {
            return JSON.stringify(_data, null, 4);
        };

        this.get = function(name) {
            return _data[name];
        };

        this.set = function(name, value) {

            if (name && typeof name == "object") {
                return Object.keys(name).forEach(key => this.set(key, name[key]));
            }

            var oldValue = _data[name];
            
            if (equals(oldValue, value)) {
                return false;
            }

            _data[name] = value;
                
            this.dispatch(new Event("change:" + name, {
                name    : name,
                oldValue: oldValue,
                newValue: value
            }));

            this.dispatch(new Event("change", {
                name    : name,
                oldValue: oldValue,
                newValue: value
            }));

            return true;
        };

        this.setData = function(data) {
            for (var name in data) {
                this.set(name, data[name]);
            }
        };
    }

    /**
     * jQuery plugin to highlight changed fields
     */
    $.fn.highlight = function() {
        return this.each(function(i, el) {
            var $el = $(el);
            var timer = $el.data("timer");
            if (timer) clearTimeout(timer);
            $el.data("timer", setTimeout(function() {
                $el.addClass("un-highlighted");
                $el.data("timer", setTimeout(function() {
                    $el.removeClass("highlighted un-highlighted").removeData("timer");
                }, 1200));
            }, 20));
            return $el.removeClass("un-highlighted").addClass("highlighted");
        })
    };

    function copyElement(selector) {
        var el = $(selector)[0];
        if (el && el.focus && el.select) {
            el.focus();
            el.select();
            document.execCommand('copy');
        }
    }



    // Export
    // =========================================================================
    
    var Lib = {

        // Common functions
        getUrlQuery      : getUrlQuery,
        toCamelCase      : toCamelCase,
        base64UrlUnescape: base64UrlUnescape,
        base64UrlEscape  : base64UrlEscape,
        base64UrlEncode  : base64UrlEncode,
        base64UrlDecode  : base64UrlDecode,
        bool             : bool,
        copyElement      : copyElement,
        equals           : equals,

        // Classes
        Event     : Event,
        Observable: Observable,
        Model     : Model
    };

    // Export at window.Lib:
    if (typeof window == "object") {
        Object.defineProperty(window, "Lib", {
            enumerable: true,
            value     : Lib
        });
    }

    if (typeof module == "object" && module.exports) {
        module.exports = Lib;
    }

    return Lib;

})(jQuery);
