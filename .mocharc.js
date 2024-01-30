module.exports = {
    require: "ts-node/register",
    watch: false,
    spec: ["tests/*.test.ts", "tests/*.test.js"],
    // ignore: ["tests/import.test.js"],
    // parallel: true,
    timeout: 2000, // defaults to 2000ms; increase if needed
    checkLeaks: true
}