/* eslint-disable @typescript-eslint/no-require-imports */
const path = require("path");
const HtmlWebpackPlugin = require("html-webpack-plugin");

const devCerts = (() => {
  try {
    return require("office-addin-dev-certs");
  } catch {
    return null;
  }
})();

module.exports = async (env, options) => {
  const isDev = options.mode === "development";

  const httpsConfig = isDev && devCerts
    ? await devCerts.getHttpsServerOptions()
    : false;

  return {
    entry: {
      taskpane: "./src/taskpane/index.tsx",
      functions: "./src/functions/functions.ts",
    },
    output: {
      path: path.resolve(__dirname, "dist"),
      filename: "[name].js",
      clean: true,
    },
    resolve: {
      extensions: [".ts", ".tsx", ".js"],
    },
    module: {
      rules: [
        { test: /\.tsx?$/, use: "ts-loader", exclude: /node_modules/ },
        { test: /\.css$/, use: ["style-loader", "css-loader"] },
      ],
    },
    plugins: [
      new HtmlWebpackPlugin({
        filename: "taskpane.html",
        template: "./src/taskpane/taskpane.html",
        chunks: ["taskpane"],
      }),
    ],
    devServer: {
      port: 3000,
      https: httpsConfig,
      headers: { "Access-Control-Allow-Origin": "*" },
    },
    devtool: isDev ? "source-map" : false,
  };
};
