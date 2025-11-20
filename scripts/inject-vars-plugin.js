import { createFilter } from '@rollup/pluginutils';
import { walk } from 'estree-walker';
import MagicString from 'magic-string';

/**
 * @param {Object<string, string|number|boolean|{ raw: string }>} replacements
 * @param {Object} [options]
 * @param {string|string[]} [options.include]
 * @param {string|string[]} [options.exclude]
 */
export function globalReplacePlugin(replacements, options = {}) {
    const filter = createFilter(options.include, options.exclude);

    return {
        name: 'custom-global-replace',

        transform(code, id) {
            if (!filter(id)) return null;

            const ast = this.parse(code);
            const s = new MagicString(code);

            walk(ast, {
                enter(node, parent) {
                    if (node.type !== 'Identifier') return;

                    const name = node.name;

                    if (!Object.prototype.hasOwnProperty.call(replacements, name)) return;

                    const replacement = replacements[name];
                    if (replacement === undefined) return;

                    // 忽略对象 key 或成员属性名
                    const isObjectKey =
                        parent &&
                        ((parent.type === 'Property' && parent.key === node && !parent.computed) ||
                            (parent.type === 'MemberExpression' &&
                                parent.property === node &&
                                !parent.computed));
                    if (isObjectKey) return;

                    let replacementCode;

                    if (
                        typeof replacement === 'object' &&
                        replacement !== null &&
                        'raw' in replacement
                    ) {
                        if (typeof replacement.raw !== 'string') {
                            throw new Error(
                                `[globalReplacePlugin] "raw" replacement for "${name}" must be a string. Got: ${typeof replacement.raw}`,
                            );
                        }
                        replacementCode = replacement.raw;
                    } else {
                        try {
                            replacementCode = JSON.stringify(replacement);
                        } catch {
                            replacementCode = String(replacement);
                        }

                        if (typeof replacementCode !== 'string') {
                            throw new Error(
                                `[globalReplacePlugin] Replacement for "${name}" must resolve to a string. Got: ${typeof replacementCode}`,
                            );
                        }
                    }

                    if (parent?.type === 'Property' && parent.shorthand) {
                        replacementCode = `${name}:${replacementCode}`;
                    }

                    s.overwrite(node.start, node.end, replacementCode);
                },
            });

            return {
                code: s.toString(),
                map: s.generateMap({ hires: true }),
            };
        },
    };
}
