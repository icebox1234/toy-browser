const css = require('css');

let rules = [];
module.exports = function generateCSSRules(text) {
    let ast = css.parse(text);
    // console.log(JSON.stringify(ast, null, '   '));
    rules.push(...ast.stylesheet.rules);
    return rules;
}