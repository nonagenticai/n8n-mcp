"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ConfigValidator = void 0;
const expression_utils_js_1 = require("../utils/expression-utils.js");
class ConfigValidator {
    static validate(nodeType, config, properties, userProvidedKeys) {
        if (!config || typeof config !== 'object') {
            throw new TypeError('Config must be a non-null object');
        }
        if (!properties || !Array.isArray(properties)) {
            throw new TypeError('Properties must be a non-null array');
        }
        const errors = [];
        const warnings = [];
        const suggestions = [];
        const visibleProperties = [];
        const hiddenProperties = [];
        const autofix = {};
        this.checkRequiredProperties(properties, config, errors);
        const { visible, hidden } = this.getPropertyVisibility(properties, config);
        visibleProperties.push(...visible);
        hiddenProperties.push(...hidden);
        this.validatePropertyTypes(properties, config, errors);
        this.performNodeSpecificValidation(nodeType, config, errors, warnings, suggestions, autofix);
        this.checkCommonIssues(nodeType, config, properties, warnings, suggestions, userProvidedKeys);
        this.performSecurityChecks(nodeType, config, warnings);
        return {
            valid: errors.length === 0,
            errors,
            warnings,
            suggestions,
            visibleProperties,
            hiddenProperties,
            autofix: Object.keys(autofix).length > 0 ? autofix : undefined
        };
    }
    static validateBatch(configs) {
        return configs.map(({ nodeType, config, properties }) => this.validate(nodeType, config, properties));
    }
    static checkRequiredProperties(properties, config, errors) {
        for (const prop of properties) {
            if (!prop || !prop.name)
                continue;
            if (prop.required) {
                const value = config[prop.name];
                if (!(prop.name in config)) {
                    errors.push({
                        type: 'missing_required',
                        property: prop.name,
                        message: `Required property '${prop.displayName || prop.name}' is missing`,
                        fix: `Add ${prop.name} to your configuration`
                    });
                }
                else if (value === null || value === undefined) {
                    errors.push({
                        type: 'invalid_type',
                        property: prop.name,
                        message: `Required property '${prop.displayName || prop.name}' cannot be null or undefined`,
                        fix: `Provide a valid value for ${prop.name}`
                    });
                }
                else if (typeof value === 'string' && value.trim() === '') {
                    errors.push({
                        type: 'missing_required',
                        property: prop.name,
                        message: `Required property '${prop.displayName || prop.name}' cannot be empty`,
                        fix: `Provide a valid value for ${prop.name}`
                    });
                }
            }
        }
    }
    static getPropertyVisibility(properties, config) {
        const visible = [];
        const hidden = [];
        for (const prop of properties) {
            if (this.isPropertyVisible(prop, config)) {
                visible.push(prop.name);
            }
            else {
                hidden.push(prop.name);
            }
        }
        return { visible, hidden };
    }
    static evaluateCondition(condition, configValue) {
        const cnd = condition._cnd;
        if ('eq' in cnd)
            return configValue === cnd.eq;
        if ('not' in cnd)
            return configValue !== cnd.not;
        if ('gte' in cnd)
            return configValue >= cnd.gte;
        if ('lte' in cnd)
            return configValue <= cnd.lte;
        if ('gt' in cnd)
            return configValue > cnd.gt;
        if ('lt' in cnd)
            return configValue < cnd.lt;
        if ('between' in cnd) {
            const between = cnd.between;
            if (!between || typeof between.from === 'undefined' || typeof between.to === 'undefined') {
                return false;
            }
            return configValue >= between.from && configValue <= between.to;
        }
        if ('startsWith' in cnd) {
            return typeof configValue === 'string' && configValue.startsWith(cnd.startsWith);
        }
        if ('endsWith' in cnd) {
            return typeof configValue === 'string' && configValue.endsWith(cnd.endsWith);
        }
        if ('includes' in cnd) {
            return typeof configValue === 'string' && configValue.includes(cnd.includes);
        }
        if ('regex' in cnd) {
            if (typeof configValue !== 'string')
                return false;
            try {
                return new RegExp(cnd.regex).test(configValue);
            }
            catch {
                return false;
            }
        }
        if ('exists' in cnd) {
            return configValue !== undefined && configValue !== null;
        }
        return false;
    }
    static valueMatches(expectedValue, configValue) {
        if (expectedValue && typeof expectedValue === 'object' && '_cnd' in expectedValue) {
            return this.evaluateCondition(expectedValue, configValue);
        }
        return configValue === expectedValue;
    }
    static isPropertyVisible(prop, config) {
        if (!prop.displayOptions)
            return true;
        if (prop.displayOptions.show) {
            for (const [key, values] of Object.entries(prop.displayOptions.show)) {
                const configValue = config[key];
                const expectedValues = Array.isArray(values) ? values : [values];
                const anyMatch = expectedValues.some(expected => this.valueMatches(expected, configValue));
                if (!anyMatch) {
                    return false;
                }
            }
        }
        if (prop.displayOptions.hide) {
            for (const [key, values] of Object.entries(prop.displayOptions.hide)) {
                const configValue = config[key];
                const expectedValues = Array.isArray(values) ? values : [values];
                const anyMatch = expectedValues.some(expected => this.valueMatches(expected, configValue));
                if (anyMatch) {
                    return false;
                }
            }
        }
        return true;
    }
    static validatePropertyTypes(properties, config, errors) {
        for (const [key, value] of Object.entries(config)) {
            const prop = properties.find(p => p.name === key);
            if (!prop)
                continue;
            if (prop.type === 'string' && typeof value !== 'string') {
                errors.push({
                    type: 'invalid_type',
                    property: key,
                    message: `Property '${key}' must be a string, got ${typeof value}`,
                    fix: `Change ${key} to a string value`
                });
            }
            else if (prop.type === 'number' && typeof value !== 'number') {
                errors.push({
                    type: 'invalid_type',
                    property: key,
                    message: `Property '${key}' must be a number, got ${typeof value}`,
                    fix: `Change ${key} to a number`
                });
            }
            else if (prop.type === 'boolean' && typeof value !== 'boolean') {
                errors.push({
                    type: 'invalid_type',
                    property: key,
                    message: `Property '${key}' must be a boolean, got ${typeof value}`,
                    fix: `Change ${key} to true or false`
                });
            }
            else if (prop.type === 'resourceLocator') {
                if (typeof value !== 'object' || value === null || Array.isArray(value)) {
                    const fixValue = typeof value === 'string' ? value : JSON.stringify(value);
                    errors.push({
                        type: 'invalid_type',
                        property: key,
                        message: `Property '${key}' is a resourceLocator and must be an object with 'mode' and 'value' properties, got ${typeof value}`,
                        fix: `Change ${key} to { mode: "list", value: ${JSON.stringify(fixValue)} } or { mode: "id", value: ${JSON.stringify(fixValue)} }`
                    });
                }
                else {
                    if (!value.mode) {
                        errors.push({
                            type: 'missing_required',
                            property: `${key}.mode`,
                            message: `resourceLocator '${key}' is missing required property 'mode'`,
                            fix: `Add mode property: { mode: "list", value: ${JSON.stringify(value.value || '')} }`
                        });
                    }
                    else if (typeof value.mode !== 'string') {
                        errors.push({
                            type: 'invalid_type',
                            property: `${key}.mode`,
                            message: `resourceLocator '${key}.mode' must be a string, got ${typeof value.mode}`,
                            fix: `Set mode to a valid string value`
                        });
                    }
                    else if (prop.modes) {
                        const modes = prop.modes;
                        if (!modes || typeof modes !== 'object') {
                            continue;
                        }
                        let allowedModes = [];
                        if (Array.isArray(modes)) {
                            allowedModes = modes
                                .map(m => (typeof m === 'object' && m !== null) ? m.name : m)
                                .filter(m => typeof m === 'string' && m.length > 0);
                        }
                        else {
                            allowedModes = Object.keys(modes).filter(k => k.length > 0);
                        }
                        if (allowedModes.length > 0 && !allowedModes.includes(value.mode)) {
                            errors.push({
                                type: 'invalid_value',
                                property: `${key}.mode`,
                                message: `resourceLocator '${key}.mode' must be one of [${allowedModes.join(', ')}], got '${value.mode}'`,
                                fix: `Change mode to one of: ${allowedModes.join(', ')}`
                            });
                        }
                    }
                    if (value.value === undefined) {
                        errors.push({
                            type: 'missing_required',
                            property: `${key}.value`,
                            message: `resourceLocator '${key}' is missing required property 'value'`,
                            fix: `Add value property to specify the ${prop.displayName || key}`
                        });
                    }
                }
            }
            if (prop.type === 'options' && prop.options) {
                const validValues = prop.options.map((opt) => typeof opt === 'string' ? opt : opt.value);
                if (!validValues.includes(value)) {
                    errors.push({
                        type: 'invalid_value',
                        property: key,
                        message: `Invalid value for '${key}'. Must be one of: ${validValues.join(', ')}`,
                        fix: `Change ${key} to one of the valid options`
                    });
                }
            }
        }
    }
    static performNodeSpecificValidation(nodeType, config, errors, warnings, suggestions, autofix) {
        switch (nodeType) {
            case 'nodes-base.httpRequest':
                this.validateHttpRequest(config, errors, warnings, suggestions, autofix);
                break;
            case 'nodes-base.webhook':
                this.validateWebhook(config, warnings, suggestions);
                break;
            case 'nodes-base.postgres':
            case 'nodes-base.mysql':
                this.validateDatabase(config, warnings, suggestions);
                break;
            case 'nodes-base.code':
                this.validateCode(config, errors, warnings);
                break;
        }
    }
    static validateHttpRequest(config, errors, warnings, suggestions, autofix) {
        if (config.url && typeof config.url === 'string') {
            if (!(0, expression_utils_js_1.shouldSkipLiteralValidation)(config.url)) {
                if (!config.url.startsWith('http://') && !config.url.startsWith('https://')) {
                    errors.push({
                        type: 'invalid_value',
                        property: 'url',
                        message: 'URL must start with http:// or https://',
                        fix: 'Add https:// to the beginning of your URL'
                    });
                }
            }
        }
        if (['POST', 'PUT', 'PATCH'].includes(config.method) && !config.sendBody) {
            warnings.push({
                type: 'missing_common',
                property: 'sendBody',
                message: `${config.method} requests typically send a body`,
                suggestion: 'Set sendBody=true and configure the body content'
            });
            autofix.sendBody = true;
            autofix.contentType = 'json';
        }
        if (!config.authentication || config.authentication === 'none') {
            if (config.url?.includes('api.') || config.url?.includes('/api/')) {
                warnings.push({
                    type: 'security',
                    message: 'API endpoints typically require authentication',
                    suggestion: 'Consider setting authentication if the API requires it'
                });
            }
        }
        if (config.sendBody && config.contentType === 'json' && config.jsonBody) {
            if (!(0, expression_utils_js_1.shouldSkipLiteralValidation)(config.jsonBody)) {
                try {
                    JSON.parse(config.jsonBody);
                }
                catch (e) {
                    const errorMsg = e instanceof Error ? e.message : 'Unknown parsing error';
                    errors.push({
                        type: 'invalid_value',
                        property: 'jsonBody',
                        message: `jsonBody contains invalid JSON: ${errorMsg}`,
                        fix: 'Fix JSON syntax error and ensure valid JSON format'
                    });
                }
            }
        }
    }
    static validateWebhook(config, warnings, suggestions) {
        if (config.responseMode === 'responseNode' && !config.responseData) {
            suggestions.push('When using responseMode=responseNode, add a "Respond to Webhook" node to send custom responses');
        }
    }
    static validateDatabase(config, warnings, suggestions) {
        if (config.query) {
            const query = config.query.toLowerCase();
            if (query.includes('${') || query.includes('{{')) {
                warnings.push({
                    type: 'security',
                    message: 'Query contains template expressions that might be vulnerable to SQL injection',
                    suggestion: 'Use parameterized queries with additionalFields.queryParams instead'
                });
            }
            if (query.includes('delete') && !query.includes('where')) {
                warnings.push({
                    type: 'security',
                    message: 'DELETE query without WHERE clause will delete all records',
                    suggestion: 'Add a WHERE clause to limit the deletion'
                });
            }
            if (query.includes('select *')) {
                suggestions.push('Consider selecting specific columns instead of * for better performance');
            }
        }
    }
    static validateCode(config, errors, warnings) {
        const codeField = config.language === 'python' ? 'pythonCode' : 'jsCode';
        const code = config[codeField];
        if (!code || code.trim() === '') {
            errors.push({
                type: 'missing_required',
                property: codeField,
                message: 'Code cannot be empty',
                fix: 'Add your code logic'
            });
            return;
        }
        if (code?.includes('eval(') || code?.includes('exec(')) {
            warnings.push({
                type: 'security',
                message: 'Code contains eval/exec which can be a security risk',
                suggestion: 'Avoid using eval/exec with untrusted input'
            });
        }
        if (config.language === 'python') {
            this.validatePythonSyntax(code, errors, warnings);
        }
        else {
            this.validateJavaScriptSyntax(code, errors, warnings);
        }
        this.validateN8nCodePatterns(code, config.language || 'javascript', errors, warnings);
    }
    static checkCommonIssues(nodeType, config, properties, warnings, suggestions, userProvidedKeys) {
        if (nodeType === 'nodes-base.code') {
            return;
        }
        const visibleProps = properties.filter(p => this.isPropertyVisible(p, config));
        const configuredKeys = Object.keys(config);
        for (const key of configuredKeys) {
            if (key === '@version' || key.startsWith('_')) {
                continue;
            }
            if (userProvidedKeys && !userProvidedKeys.has(key)) {
                continue;
            }
            const prop = properties.find(p => p.name === key);
            if (prop && this.UI_ONLY_TYPES.includes(prop.type)) {
                continue;
            }
            if (!visibleProps.find(p => p.name === key)) {
                const visibilityReq = this.getVisibilityRequirement(prop, config);
                warnings.push({
                    type: 'inefficient',
                    property: key,
                    message: `Property '${prop?.displayName || key}' won't be used - not visible with current settings`,
                    suggestion: visibilityReq || 'Remove this property or adjust other settings to make it visible'
                });
            }
        }
        const commonProps = ['authentication', 'errorHandling', 'timeout'];
        for (const prop of commonProps) {
            const propDef = properties.find(p => p.name === prop);
            if (propDef && this.isPropertyVisible(propDef, config) && !(prop in config)) {
                suggestions.push(`Consider setting '${prop}' for better control`);
            }
        }
    }
    static performSecurityChecks(nodeType, config, warnings) {
        const sensitivePatterns = [
            /api[_-]?key/i,
            /password/i,
            /secret/i,
            /token/i,
            /credential/i
        ];
        for (const [key, value] of Object.entries(config)) {
            if (typeof value === 'string') {
                for (const pattern of sensitivePatterns) {
                    if (pattern.test(key) && value.length > 0 && !value.includes('{{')) {
                        warnings.push({
                            type: 'security',
                            property: key,
                            message: `Hardcoded ${key} detected`,
                            suggestion: 'Use n8n credentials or expressions instead of hardcoding sensitive values'
                        });
                        break;
                    }
                }
            }
        }
    }
    static getVisibilityRequirement(prop, config) {
        if (!prop || !prop.displayOptions?.show) {
            return undefined;
        }
        const requirements = [];
        for (const [field, values] of Object.entries(prop.displayOptions.show)) {
            const expectedValues = Array.isArray(values) ? values : [values];
            const currentValue = config[field];
            if (!expectedValues.includes(currentValue)) {
                const valueStr = expectedValues.length === 1
                    ? `"${expectedValues[0]}"`
                    : expectedValues.map(v => `"${v}"`).join(' or ');
                requirements.push(`${field}=${valueStr}`);
            }
        }
        if (requirements.length === 0) {
            return undefined;
        }
        return `Requires: ${requirements.join(', ')}`;
    }
    static validateJavaScriptSyntax(code, errors, warnings) {
        const openBraces = (code.match(/\{/g) || []).length;
        const closeBraces = (code.match(/\}/g) || []).length;
        if (openBraces !== closeBraces) {
            errors.push({
                type: 'invalid_value',
                property: 'jsCode',
                message: 'Unbalanced braces detected',
                fix: 'Check that all { have matching }'
            });
        }
        const openParens = (code.match(/\(/g) || []).length;
        const closeParens = (code.match(/\)/g) || []).length;
        if (openParens !== closeParens) {
            errors.push({
                type: 'invalid_value',
                property: 'jsCode',
                message: 'Unbalanced parentheses detected',
                fix: 'Check that all ( have matching )'
            });
        }
        const stringMatches = code.match(/(["'`])(?:(?=(\\?))\2.)*?\1/g) || [];
        const quotesInStrings = stringMatches.join('').match(/["'`]/g)?.length || 0;
        const totalQuotes = (code.match(/["'`]/g) || []).length;
        if ((totalQuotes - quotesInStrings) % 2 !== 0) {
            warnings.push({
                type: 'inefficient',
                message: 'Possible unterminated string detected',
                suggestion: 'Check that all strings are properly closed'
            });
        }
    }
    static validatePythonSyntax(code, errors, warnings) {
        const lines = code.split('\n');
        const indentTypes = new Set();
        lines.forEach(line => {
            const indent = line.match(/^(\s+)/);
            if (indent) {
                if (indent[1].includes('\t'))
                    indentTypes.add('tabs');
                if (indent[1].includes(' '))
                    indentTypes.add('spaces');
            }
        });
        if (indentTypes.size > 1) {
            errors.push({
                type: 'syntax_error',
                property: 'pythonCode',
                message: 'Mixed indentation (tabs and spaces)',
                fix: 'Use either tabs or spaces consistently, not both'
            });
        }
        const openSquare = (code.match(/\[/g) || []).length;
        const closeSquare = (code.match(/\]/g) || []).length;
        if (openSquare !== closeSquare) {
            errors.push({
                type: 'syntax_error',
                property: 'pythonCode',
                message: 'Unmatched bracket - missing ] or extra [',
                fix: 'Check that all [ have matching ]'
            });
        }
        const openCurly = (code.match(/\{/g) || []).length;
        const closeCurly = (code.match(/\}/g) || []).length;
        if (openCurly !== closeCurly) {
            errors.push({
                type: 'syntax_error',
                property: 'pythonCode',
                message: 'Unmatched bracket - missing } or extra {',
                fix: 'Check that all { have matching }'
            });
        }
        const controlStructures = /^\s*(if|elif|else|for|while|def|class|try|except|finally|with)\s+.*[^:]\s*$/gm;
        if (controlStructures.test(code)) {
            warnings.push({
                type: 'inefficient',
                message: 'Missing colon after control structure',
                suggestion: 'Add : at the end of if/for/def/class statements'
            });
        }
    }
    static validateN8nCodePatterns(code, language, errors, warnings) {
        const hasReturn = language === 'python'
            ? /return\s+/.test(code)
            : /return\s+/.test(code);
        if (!hasReturn) {
            warnings.push({
                type: 'missing_common',
                message: 'No return statement found',
                suggestion: 'Code node must return data. Example: return [{json: {result: "success"}}]'
            });
        }
        if (language === 'javascript' && hasReturn) {
            if (/return\s+items\s*;/.test(code) && !code.includes('.map') && !code.includes('json:')) {
                warnings.push({
                    type: 'best_practice',
                    message: 'Returning items directly - ensure each item has {json: ...} structure',
                    suggestion: 'If modifying items, use: return items.map(item => ({json: {...item.json, newField: "value"}}))'
                });
            }
            if (/return\s+{[^}]+}\s*;/.test(code) && !code.includes('[') && !code.includes(']')) {
                warnings.push({
                    type: 'invalid_value',
                    message: 'Return value must be an array',
                    suggestion: 'Wrap your return object in an array: return [{json: {your: "data"}}]'
                });
            }
            if (/return\s+\[['"`]/.test(code) || /return\s+\[\d/.test(code)) {
                warnings.push({
                    type: 'invalid_value',
                    message: 'Items must be objects with json property',
                    suggestion: 'Use format: return [{json: {value: "data"}}] not return ["data"]'
                });
            }
        }
        if (language === 'python' && hasReturn) {
            if (code.includes('result = {"data": "value"}')) {
                console.log('DEBUG: Processing Python code with result variable');
                console.log('DEBUG: Language:', language);
                console.log('DEBUG: Has return:', hasReturn);
            }
            if (/return\s+items\s*$/.test(code) && !code.includes('json') && !code.includes('dict')) {
                warnings.push({
                    type: 'best_practice',
                    message: 'Returning items directly - ensure each item is a dict with "json" key',
                    suggestion: 'Use: return [{"json": item.json} for item in items]'
                });
            }
            if (/return\s+{['"]/.test(code) && !code.includes('[') && !code.includes(']')) {
                warnings.push({
                    type: 'invalid_value',
                    message: 'Return value must be a list',
                    suggestion: 'Wrap your return dict in a list: return [{"json": {"your": "data"}}]'
                });
            }
            if (/return\s+(?!.*\[).*{(?!.*["']json["'])/.test(code)) {
                warnings.push({
                    type: 'invalid_value',
                    message: 'Must return array of objects with json key',
                    suggestion: 'Use format: return [{"json": {"data": "value"}}]'
                });
            }
            const returnMatch = code.match(/return\s+(\w+)\s*(?:#|$)/m);
            if (returnMatch) {
                const varName = returnMatch[1];
                const assignmentRegex = new RegExp(`${varName}\\s*=\\s*{[^}]+}`, 'm');
                if (assignmentRegex.test(code) && !new RegExp(`${varName}\\s*=\\s*\\[`).test(code)) {
                    warnings.push({
                        type: 'invalid_value',
                        message: 'Must return array of objects with json key',
                        suggestion: `Wrap ${varName} in a list with json key: return [{"json": ${varName}}]`
                    });
                }
            }
        }
        if (language === 'javascript') {
            if (!code.includes('items') && !code.includes('$input') && !code.includes('$json')) {
                warnings.push({
                    type: 'missing_common',
                    message: 'Code doesn\'t reference input data',
                    suggestion: 'Access input with: items, $input.all(), or $json (in single-item mode)'
                });
            }
            if (code.includes('$json') && !code.includes('mode')) {
                warnings.push({
                    type: 'best_practice',
                    message: '$json only works in "Run Once for Each Item" mode',
                    suggestion: 'For all items mode, use: items[0].json or loop through items'
                });
            }
            const commonVars = ['$node', '$workflow', '$execution', '$prevNode', 'DateTime', 'jmespath'];
            const usedVars = commonVars.filter(v => code.includes(v));
            if (code.includes('$helpers.getWorkflowStaticData')) {
                if (/\$helpers\.getWorkflowStaticData(?!\s*\()/.test(code)) {
                    errors.push({
                        type: 'invalid_value',
                        property: 'jsCode',
                        message: 'getWorkflowStaticData requires parentheses: $helpers.getWorkflowStaticData()',
                        fix: 'Add parentheses: $helpers.getWorkflowStaticData()'
                    });
                }
                else {
                    warnings.push({
                        type: 'invalid_value',
                        message: '$helpers.getWorkflowStaticData() is incorrect - causes "$helpers is not defined" error',
                        suggestion: 'Use $getWorkflowStaticData() as a standalone function (no $helpers prefix)'
                    });
                }
            }
            if (code.includes('$helpers') && !code.includes('typeof $helpers')) {
                warnings.push({
                    type: 'best_practice',
                    message: '$helpers is only available in Code nodes with mode="runOnceForEachItem"',
                    suggestion: 'Check availability first: if (typeof $helpers !== "undefined" && $helpers.httpRequest) { ... }'
                });
            }
            if ((code.includes('fetch(') || code.includes('Promise') || code.includes('.then(')) && !code.includes('await')) {
                warnings.push({
                    type: 'best_practice',
                    message: 'Async operation without await - will return a Promise instead of actual data',
                    suggestion: 'Use await with async operations: const result = await fetch(...);'
                });
            }
            if ((code.includes('crypto.') || code.includes('randomBytes') || code.includes('randomUUID')) && !code.includes('require')) {
                warnings.push({
                    type: 'invalid_value',
                    message: 'Using crypto without require statement',
                    suggestion: 'Add: const crypto = require("crypto"); at the beginning (ignore editor warnings)'
                });
            }
            if (code.includes('console.log')) {
                warnings.push({
                    type: 'best_practice',
                    message: 'console.log output appears in n8n execution logs',
                    suggestion: 'Remove console.log statements in production or use them sparingly'
                });
            }
        }
        else if (language === 'python') {
            if (!code.includes('items') && !code.includes('_input')) {
                warnings.push({
                    type: 'missing_common',
                    message: 'Code doesn\'t reference input items',
                    suggestion: 'Access input data with: items variable'
                });
            }
            if (code.includes('print(')) {
                warnings.push({
                    type: 'best_practice',
                    message: 'print() output appears in n8n execution logs',
                    suggestion: 'Remove print statements in production or use them sparingly'
                });
            }
            if (code.includes('import requests') || code.includes('import pandas')) {
                warnings.push({
                    type: 'invalid_value',
                    message: 'External libraries not available in Code node',
                    suggestion: 'Only Python standard library is available. For HTTP requests, use JavaScript with $helpers.httpRequest'
                });
            }
        }
        if (/while\s*\(\s*true\s*\)|while\s+True:/.test(code)) {
            warnings.push({
                type: 'security',
                message: 'Infinite loop detected',
                suggestion: 'Add a break condition or use a for loop with limits'
            });
        }
        if (!code.includes('try') && !code.includes('catch') && !code.includes('except')) {
            if (code.length > 200) {
                warnings.push({
                    type: 'best_practice',
                    message: 'No error handling found',
                    suggestion: 'Consider adding try/catch (JavaScript) or try/except (Python) for robust error handling'
                });
            }
        }
    }
}
exports.ConfigValidator = ConfigValidator;
ConfigValidator.UI_ONLY_TYPES = ['notice', 'callout', 'infoBox', 'info'];
//# sourceMappingURL=config-validator.js.map