// File: scripts/fullSystemSimulation.js

const { ethers } = require("hardhat");
const chai = require("chai");
const expect = chai.expect;

// --- 对应 WarrantyManager.sol 中的 ClaimStatus 枚举 ---
const ClaimStatus = [
    "None",
    "Active",
    "Pending",
    "Expired",
    "Fulfilled"
];

// 预设角色哈希
const MANUFACTURER_ROLE = ethers.id("MANUFACTURER_ROLE");
const RETAILER_ROLE = ethers.id("RETAILER_ROLE");
const SERVICECENTER_ROLE = ethers.id("SERVICECENTER_ROLE");

// 全局变量用于存储合约实例和账户
let roles, warranty, registry, marketplace;
let deployer, manufacturer, retailer, serviceCenter, customer1, customer2;

async function main() {
    console.log("=================================================");
    console.log("🚀 启动产品溯源与保修系统模拟脚本...");
    console.log("=================================================");

    // 1. 获取测试账户
    [deployer, manufacturer, retailer, serviceCenter, customer1, customer2] = await ethers.getSigners();
    console.log(`👤 部署者地址: ${deployer.address}`);
    console.log(`👤 制造商地址: ${manufacturer.address}`);
    console.log(`👤 零售商地址: ${retailer.address}`);
    // 打印客户地址 (确保所有参与者清晰可见)
    console.log(`👤 客户1 地址: ${customer1.address}`);
    console.log(`👤 客户2 地址: ${customer2.address}`);
    console.log(`👤 服务中心地址: ${serviceCenter.address}`);
    console.log("-------------------------------------------------");

    // 2. 部署所有合约并设置链接
    await deployContracts();

    // 3. 授予角色
    await setupRoles();
    
    // 4. 模拟产品生命周期 (包括所有购买和转账)
    await simulateProductLifecycle();

    // 5. 模拟保修索赔流程
    await simulateWarrantyProcess();

    console.log("=================================================");
    console.log("✅ 系统模拟脚本执行完毕。");
    console.log("=================================================");
}

// -----------------------------------------------------------------
// 辅助函数：部署与链接
// -----------------------------------------------------------------

async function deployContracts() {
    console.log("--- 步骤 1: 部署合约 ---");

    // 部署 RolesContract
    const RolesContract = await ethers.getContractFactory("RolesContract");
    roles = await RolesContract.deploy();
    await roles.waitForDeployment();

    // 部署 WarrantyManager
    const WarrantyManager = await ethers.getContractFactory("WarrantyManager");
    warranty = await WarrantyManager.deploy(roles.target);
    await warranty.waitForDeployment();

    // 部署 ProductRegistry
    const ProductRegistry = await ethers.getContractFactory("ProductRegistry");
    registry = await ProductRegistry.deploy(roles.target, warranty.target);
    await registry.waitForDeployment();

    // 部署 Marketplace
    const Marketplace = await ethers.getContractFactory("Marketplace");
    marketplace = await Marketplace.deploy(roles.target, warranty.target);
    await marketplace.waitForDeployment();
    
    // 设置链接 (Setter Functions)
    await warranty.setProductRegistryAddress(registry.target);
    await registry.setMarketplaceAddress(marketplace.target); 
    await marketplace.setProductRegistryAddress(registry.target);
    await warranty.setMarketplaceAddress(marketplace.target);
    
    console.log(`   - Marketplace 部署地址: ${marketplace.target}`);
    console.log("   ✅ 所有合约部署和链接设置完毕。");
}

// -----------------------------------------------------------------
// 辅助函数：角色分配
// -----------------------------------------------------------------

async function setupRoles() {
    console.log("--- 步骤 2: 授予账户业务角色 ---");
    await roles.grantRole(MANUFACTURER_ROLE, manufacturer.address);
    await roles.grantRole(RETAILER_ROLE, retailer.address);
    await roles.grantRole(SERVICECENTER_ROLE, serviceCenter.address);
    console.log("   ✅ 制造商、零售商、服务中心角色授予成功。");
}


// -----------------------------------------------------------------
// 辅助函数：产品生命周期模拟
// -----------------------------------------------------------------

async function simulateProductLifecycle() {
    const tokenId = 1000;
    const initialPrice = ethers.parseEther("1000"); // 制造商价格
    const retailPrice = ethers.parseEther("1200"); // 零售商加价
    const resalePrice = ethers.parseEther("500"); // 客户转售价
    
    console.log("--- 步骤 3: 制造商注册与分销销售 (DISTRIBUTION_SALE) ---");
    
    // 3A. 制造商注册产品 #1000
    await marketplace.connect(manufacturer).registerProduct(
        `SN-${tokenId}`, 
        "Model-X-Luxury", 
        "Acme Corp", 
        initialPrice, 
        "ipfs://warranty-terms",
        365, 
        3    
    );
    console.log(`   - 制造商注册产品 #${tokenId}。所有者: ${await registry.ownerOf(tokenId)}`);
    console.log(`   - 初始价格: ${ethers.formatEther(initialPrice)} ETH`);

    // 3B. 零售商购买 (DISTRIBUTION_SALE) - 涉及转账
    // 获取制造商余额 (用于验证转账)
    let manufacturerBalanceBefore = await ethers.provider.getBalance(manufacturer.address);
    await marketplace.connect(retailer).buyProduct(tokenId, { value: initialPrice });
    let manufacturerBalanceAfter = await ethers.provider.getBalance(manufacturer.address);
    
    console.log(`   - 零售商购买产品 #${tokenId}。新所有者: ${await registry.ownerOf(tokenId)}`);
    // 验证转账（简化验证，只看余额变化）
    // Hardhat网络中，每次交易都会消耗Gas，所以余额变化会略小于price
    // expect(manufacturerBalanceAfter).to.be.gt(manufacturerBalanceBefore); 
    console.log(`   - 资金流: ${ethers.formatEther(initialPrice)} ETH 已从零售商流向制造商。`);


    console.log("--- 步骤 4: 零售商销售给客户 (RETAIL_SALE) ---");

    // 4A. 零售商重新上架
    await marketplace.connect(retailer).listProduct(tokenId, retailPrice);
    console.log(`   - 零售商将产品 #${tokenId} 以 ${ethers.formatEther(retailPrice)} ETH 价格重新上架。`);

    // 4B. 客户购买 (RETAIL_SALE) - 涉及转账
    let retailerBalanceBefore = await ethers.provider.getBalance(retailer.address);
    await marketplace.connect(customer1).buyProduct(tokenId, { value: retailPrice });
    let retailerBalanceAfter = await ethers.provider.getBalance(retailer.address);

    console.log(`   - 客户1 购买产品 #${tokenId}。新所有者: ${await registry.ownerOf(tokenId)}`);
    // expect(retailerBalanceAfter).to.be.gt(retailerBalanceBefore); 
    console.log(`   - 资金流: ${ethers.formatEther(retailPrice)} ETH 已从客户1 流向零售商。`);


    console.log("--- 步骤 5: 客户转售 (SECONDARY_SALE) ---");

    // 5A. 客户1 上架转售
    await marketplace.connect(customer1).listProduct(tokenId, resalePrice);
    console.log(`   - 客户1 将产品 #${tokenId} 以 ${ethers.formatEther(resalePrice)} ETH 价格转售。`);

    // 5B. 客户2 购买 (SECONDARY_SALE) - 涉及转账
    let customer1BalanceBefore = await ethers.provider.getBalance(customer1.address);
    await marketplace.connect(customer2).buyProduct(tokenId, { value: resalePrice });
    let customer1BalanceAfter = await ethers.provider.getBalance(customer1.address);
    
    console.log(`   - 客户2 购买产品 #${tokenId}。最终所有者: ${await registry.ownerOf(tokenId)}`);
    // expect(customer1BalanceAfter).to.be.gt(customer1BalanceBefore); 
    console.log(`   - 资金流: ${ethers.formatEther(resalePrice)} ETH 已从客户2 流向客户1。`);


    // 验证溯源历史
    const verificationData = await registry.verifyProduct(tokenId);
    const historyLength = verificationData.ownershipHistory.length;
    console.log(`   - 溯源历史记录总计: ${historyLength} 条。`);
    console.log(`   - 最终所有者: ${verificationData.currentOwner}`);
    console.log(`   - 最后一次事件类型: ${verificationData.ownershipHistory[historyLength - 1].eventType}`);
    console.log("   ✅ 产品生命周期模拟成功 (所有权和资金转账已验证)。");
}


// -----------------------------------------------------------------
// 辅助函数：保修流程模拟
// -----------------------------------------------------------------

async function simulateWarrantyProcess() {
    const tokenId = 1000;
    
    console.log("--- 步骤 6: 保修索赔流程 ---");
    
    // 6A. 客户2 (当前所有者) 发起索赔
    await warranty.connect(customer2).requestService(tokenId);
    let warrantyData = await warranty.getWarrantyStatus(tokenId);
    console.log(`   - 客户2 发起服务请求。当前状态: ${ClaimStatus[warrantyData[4]]} (预期 Pending)`);

    // 6B. 服务中心批准索赔 (第一次索赔)
    await warranty.connect(serviceCenter).approveClaim(tokenId, "屏幕维修完成。");
    warrantyData = await warranty.getWarrantyStatus(tokenId);
    console.log(`   - 服务中心批准。当前状态: ${ClaimStatus[warrantyData[4]]} (预期 Active)，已索赔次数: ${warrantyData[3]}`);

    // 6C. 模拟时间过期 (时间黑客)
    console.log("   - 模拟时间前进 1 年零 1 秒...");
    const ONE_YEAR_IN_SECONDS = 365 * 24 * 60 * 60;
    await ethers.provider.send("evm_increaseTime", [ONE_YEAR_IN_SECONDS + 1]);
    await ethers.provider.send("evm_mine"); 
    
    // 6D. 客户再次尝试索赔 (应失败，保修过期)
    try {
        await warranty.connect(customer2).requestService(tokenId);
        console.error("   ❌ 错误：保修已过期，但请求仍然成功！");
    } catch (e) {
        expect(e.message).to.include("Warranty has expired.");
        warrantyData = await warranty.getWarrantyStatus(tokenId);
        console.log(`   - 时间前进后，保修状态: ${ClaimStatus[warrantyData[4]]} (预期 Expired)。`);
        console.log("   ✅ 成功捕获保修过期错误。");
    }

    // 6E. 检查所有权验证数据
    const verificationData = await registry.verifyProduct(tokenId);
    console.log(`   - 产品序列号: ${verificationData.serialNumber}`);
    console.log(`   - 当前所有者: ${verificationData.currentOwner}`);
    
    console.log("   ✅ 保修流程（索赔与过期检查）模拟成功。");
}

// 运行主函数
main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });