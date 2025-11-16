// File: test/Unit_Registry.test.js

const { expect } = require("chai");
const { ethers } = require("hardhat");

// Unit Test: ProductRegistry：专注于测试 NFT 铸造、数据存储和核心转让限制逻辑。
describe("Unit Test: ProductRegistry", function () {
    let roles, registry, warrantyManagerMock;
    let deployer, manufacturer, retailer, customer1, customer2, user, marketplaceMock;

    // 预设产品数据
    const PRODUCT_URI = "ipfs://product-metadata/1";
    // 合约中 _nextTokenId 从 1000 开始
    const INITIAL_TOKEN_ID = 1000; 

    // before：在所有测试开始前，部署依赖合约并设置权限。
    before(async function () {
        // 获取测试账户
        [deployer, manufacturer, retailer, customer1, customer2, user] = await ethers.getSigners();
        marketplaceMock = deployer; // 模拟 Marketplace 账户

        // 1. 部署 RolesContract 并授予角色
        const RolesContract = await ethers.getContractFactory("RolesContract");
        roles = await RolesContract.deploy();

        await roles.grantRole(ethers.id("MANUFACTURER_ROLE"), manufacturer.address);
        await roles.grantRole(ethers.id("RETAILER_ROLE"), retailer.address);

        // 2. 部署 WarrantyManager 模拟合约 (Mock)
        const MockWarrantyManager = await ethers.getContractFactory("MockWarrantyManager");
        // 模拟 WarrantyManager，默认返回 true (保修有效)，除非手动设置为 false
        warrantyManagerMock = await MockWarrantyManager.deploy(true); 

        // 3. 部署 ProductRegistry
        const ProductRegistry = await ethers.getContractFactory("ProductRegistry");
        
        // 传入 RolesContract 和 WarrantyManager 地址
        registry = await ProductRegistry.deploy(
            roles.target,
            warrantyManagerMock.target
        );

        // 4. 设置 Marketplace 地址，允许其调用受限函数
        await registry.setMarketplaceAddress(marketplaceMock.address);
    });
    
    // --- 铸造产品 (mintProduct) 保持不变 ---
    describe("铸造产品 (mintProduct)", function () {
        // ... (保持不变)
        it("非 Marketplace 调用 mintProduct 应失败 (Revert)", async function () {
            await expect(
                registry.connect(retailer).mintProduct(
                    customer1.address, 
                    "SN-0", "ModelX", "MFG Inc.", 100, PRODUCT_URI
                )
            ).to.be.revertedWith("Registry: Only Marketplace can call.");
        });

        it("Marketplace 应能成功铸造产品，并触发 Transfer 事件", async function () {
            // 验证 0x0 -> R 的铸造逻辑
            await expect(
                registry.connect(marketplaceMock).mintProduct(
                    customer1.address, 
                    "SN-1", "ModelX", "MFG Inc.", 100, PRODUCT_URI
                )
            ).to.emit(registry, "Transfer")
             .withArgs(ethers.ZeroAddress, customer1.address, INITIAL_TOKEN_ID);

            expect(await registry.ownerOf(INITIAL_TOKEN_ID)).to.equal(customer1.address);
            const [sn] = await registry.staticData(INITIAL_TOKEN_ID);
            expect(sn).to.equal("SN-1");
        });

        it("连续铸造应增加代币ID", async function () {
            await registry.connect(marketplaceMock).mintProduct(
                customer1.address, 
                "SN-2", "ModelY", "MFG Inc.", 200, "uri/2"
            );
            expect(await registry.ownerOf(INITIAL_TOKEN_ID + 1)).to.equal(customer1.address);
        });
    });

    // --- 产品转让限制 (transferFrom & safeTransferFrom) 核心修改 ---
    describe("产品转让限制 (transferFrom & safeTransferFrom)", function () {
        const tokenId = INITIAL_TOKEN_ID;
        
        // --- Customer -> Retailer (有角色) 保持不变 ---
        it("Customer 应能转让给 Retailer", async function () {
            await expect(
                registry.connect(customer1).transferFrom(customer1.address, retailer.address, tokenId)
            ).to.not.be.reverted;
            
            expect(await registry.ownerOf(tokenId)).to.equal(retailer.address);
        });

        // --- Retailer -> Customer (有角色) 保持不变 ---
        it("Retailer 应能转让给 Customer", async function () {
            await expect(
                registry.connect(retailer).transferFrom(retailer.address, customer2.address, tokenId)
            ).to.not.be.reverted;
            
            expect(await registry.ownerOf(tokenId)).to.equal(customer2.address);
        });

        // 核心修改：Customer 之间转让（restrictedTransferFrom）在保修有效时应**成功**。
        it("Customer 之间转让应成功 (限制已解除，保修仍有效)", async function () {
            // 确保 WarrantyManager Mock 返回有效 (前提条件)
            await warrantyManagerMock.setValidStatus(true); 
            
            // customer2 尝试转让给 customer1 (通过 restrictedTransferFrom)
            await expect(
                registry.connect(customer2).restrictedTransferFrom(customer2.address, customer1.address, tokenId)
            ).to.not.be.reverted; // <<<< 修改：预期不回退
            
            // 验证所有权已转
            expect(await registry.ownerOf(tokenId)).to.equal(customer1.address);
        });

        // 成功测试：Customer 之间转让（保修失效时也应成功）。
        it("Customer 之间转让应成功 (保修失效时也应成功)", async function () {
            await warrantyManagerMock.setValidStatus(false); 
            
            // customer1 尝试转让给 customer2 (通过 restrictedTransferFrom)
            await expect(
                registry.connect(customer1).restrictedTransferFrom(customer1.address, customer2.address, tokenId)
            ).to.not.be.reverted;
            
            // 验证所有权已转
            expect(await registry.ownerOf(tokenId)).to.equal(customer2.address);
        });
    });

    // --- 特殊转让：Marketplace (approve/operator) 核心修改 ---
    describe("特殊转让：Marketplace (approve/operator)", function () {
        const tokenId = INITIAL_TOKEN_ID + 1; // 使用第二个代币 (1001)
        
        before(async function () {
            await warrantyManagerMock.setValidStatus(false); 
            // 将 tokenId 1001 转移到 customer2
            await registry.connect(customer1).restrictedTransferFrom(customer1.address, customer2.address, tokenId);
            
            // 重置保修状态为有效，用于后续测试
            await warrantyManagerMock.setValidStatus(true);
        });
        
        it("允许地址应能进行转让 (在保修失效时)", async function () {
            await registry.connect(customer2).approve(user.address, tokenId);
            
            await warrantyManagerMock.setValidStatus(false); 

            await expect(
                registry.connect(user).restrictedTransferFrom(customer2.address, customer1.address, tokenId)
            ).to.not.be.reverted;
            
            expect(await registry.ownerOf(tokenId)).to.equal(customer1.address);
        });

        // 核心修改：被授权人在保修有效时进行转账应**成功**。
        it("Customer 授权后的转让，在保修有效时应成功", async function () {
            await registry.connect(customer1).approve(user.address, tokenId);
            
            // 确保保修有效 (前提条件)
            await warrantyManagerMock.setValidStatus(true); 
            
            // user (被授权人) 尝试转让 (从 customer1 到 customer2)，现在应该成功
            await expect(
                registry.connect(user).restrictedTransferFrom(customer1.address, customer2.address, tokenId)
            ).to.not.be.reverted; // <<<< 修改：预期不回退

            // 验证所有权转移
            expect(await registry.ownerOf(tokenId)).to.equal(customer2.address);
        });
    });
});