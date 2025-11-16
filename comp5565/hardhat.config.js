// hardhat.config.js

require("@nomicfoundation/hardhat-chai-matchers");

module.exports = {
  // 设置 Solidity 编译版本
  solidity: "0.8.20",
  // 确保 Hardhat 能够找到您的合约文件
  paths: {
    sources: "./contracts",
    tests: "./test",
    cache: "./cache",
    artifacts: "./artifacts"
  },
  // 配置网络 (这里是默认的本地开发网络)
  networks: {
    hardhat: {
      // 用于测试时快速跳过时间的配置
      allowUnlimitedContractSize: true
    }
  }
};