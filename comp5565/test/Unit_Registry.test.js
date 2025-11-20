// File: test/Unit_Registry.test.js

const { expect } = require("chai");
const { ethers } = require("hardhat");

// Unit Test: ProductRegistry
describe("Unit Test: ProductRegistry", function () {
    let roles, registry, warrantyManagerMock;
    let deployer, manufacturer, retailer, customer1, customer2, user, marketplaceMock;

    // 预设产品数据
    const PRODUCT_URI = "ipfs://product-metadata/1";
    // 合约中 _nextTokenId 从 1000 开始
    const INITIAL_TOKEN_ID = 1000; 
    const TEST_SERIAL_NUMBER = "SN-1"; // Token 1000 的序列号
    const TEST_MODEL_DETAILS = "ModelX"; 
    const TEST_MFG_DETAILS = "MFG Inc."; 
    const TEST_PRICE = 100n; // 铸造时的价格
    
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
        // 模拟 WarrantyManager，默认返回 true (保修有效)
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
    
    // --- 铸造产品 (mintProduct) ---
    describe("铸造产品 (mintProduct)", function () {
        it("非 Marketplace 调用 mintProduct 应失败 (Revert)", async function () {
            await expect(
                registry.connect(retailer).mintProduct(
                    customer1.address, 
                    "SN-0", "ModelX", "MFG Inc.", 100, PRODUCT_URI
                )
            ).to.be.revertedWith("Registry: Only Marketplace can call.");
        });

        it("Marketplace 应能成功铸造产品，并触发 Transfer 事件", async function () {
            // 验证 0x0 -> Customer1 的铸造逻辑，TokenID 应为 1000
            await expect(
                registry.connect(marketplaceMock).mintProduct(
                    customer1.address, 
                    TEST_SERIAL_NUMBER, 
                    TEST_MODEL_DETAILS, 
                    TEST_MFG_DETAILS, 
                    TEST_PRICE, 
                    PRODUCT_URI
                )
            ).to.emit(registry, "Transfer")
             .withArgs(ethers.ZeroAddress, customer1.address, INITIAL_TOKEN_ID);

            expect(await registry.ownerOf(INITIAL_TOKEN_ID)).to.equal(customer1.address);
            // 验证 serialNumberToTokenId 映射已被填充
            expect(await registry.serialNumberToTokenId(TEST_SERIAL_NUMBER)).to.equal(INITIAL_TOKEN_ID); 

            // 验证静态数据存储
            const [sn] = await registry.staticData(INITIAL_TOKEN_ID);
            expect(sn).to.equal(TEST_SERIAL_NUMBER);
        });

        it("连续铸造应增加代币ID", async function () {
            // 铸造 TokenID 1001
            await registry.connect(marketplaceMock).mintProduct(
                customer1.address, 
                "SN-2", "ModelY", "MFG Inc.", 200, "uri/2"
            );
            expect(await registry.ownerOf(INITIAL_TOKEN_ID + 1)).to.equal(customer1.address);
        });
    });

    // --- 产品转让限制 (transferFrom & safeTransferFrom) ---
    describe("产品转让限制 (transferFrom & safeTransferFrom)", function () {
        const tokenId = INITIAL_TOKEN_ID; // 1000
        
        // 流程：C1 -> R -> C2 -> C1 -> C2
        
        it("Customer 应能转让给 Retailer", async function () {
            await expect(
                registry.connect(customer1).transferFrom(customer1.address, retailer.address, tokenId)
            ).to.not.be.reverted;
            
            expect(await registry.ownerOf(tokenId)).to.equal(retailer.address);
        });

        it("Retailer 应能转让给 Customer", async function () {
            await expect(
                registry.connect(retailer).transferFrom(retailer.address, customer2.address, tokenId)
            ).to.not.be.reverted;
            
            expect(await registry.ownerOf(tokenId)).to.equal(customer2.address);
        });

        it("Customer 之间转让应成功 (保修有效时)", async function () {
            await warrantyManagerMock.setValidStatus(true); 
            
            // customer2 -> customer1
            await expect(
                registry.connect(customer2).restrictedTransferFrom(customer2.address, customer1.address, tokenId)
            ).to.not.be.reverted;
            
            expect(await registry.ownerOf(tokenId)).to.equal(customer1.address);
        });

        it("Customer 之间转让应成功 (保修失效时)", async function () {
            await warrantyManagerMock.setValidStatus(false); 
            
            // customer1 -> customer2
            await expect(
                registry.connect(customer1).restrictedTransferFrom(customer1.address, customer2.address, tokenId)
            ).to.not.be.reverted;
            
            expect(await registry.ownerOf(tokenId)).to.equal(customer2.address);
        });
    });

    // --- 特殊转让：Marketplace (approve/operator) ---
    describe("特殊转让：Marketplace (approve/operator)", function () {
        const tokenId = INITIAL_TOKEN_ID + 1; // 1001
        
        before(async function () {
            // 将 tokenId 1001 转移到 customer2，准备测试环境
            // Token 1001 当前所有者是 customer1 (来自铸造)，转给 customer2
            await registry.connect(customer1).restrictedTransferFrom(customer1.address, customer2.address, tokenId);
        });
        
        it("Customer 授权后的转让，在保修有效时应成功", async function () {
            await registry.connect(customer2).approve(user.address, tokenId);
            await warrantyManagerMock.setValidStatus(true); 
            
            // user (被授权人) 尝试转让
            await expect(
                registry.connect(user).restrictedTransferFrom(customer2.address, customer1.address, tokenId)
            ).to.not.be.reverted;

            expect(await registry.ownerOf(tokenId)).to.equal(customer1.address);
        });
    });

    // ======================================================
    // 新增：产品真伪验证聚合查询功能测试 (getTokenIdBySerialNumber & verifyProduct)
    // ======================================================

    describe("真伪验证聚合查询 (getTokenIdBySerialNumber & verifyProduct)", function () {
        const tokenId = INITIAL_TOKEN_ID; // 1000
        // 修复：移除此处的 expectedOwner 定义，因为它会导致 undefined 错误
        
        it("1. 通过序列号查询 Token ID 应该成功", async function () {
            const retrievedId = await registry.getTokenIdBySerialNumber(TEST_SERIAL_NUMBER);
            expect(retrievedId).to.equal(tokenId);
        });
        
        it("2. 查询不存在的序列号应该返回 0", async function () {
            const retrievedId = await registry.getTokenIdBySerialNumber("SN-NON-EXISTENT");
            expect(retrievedId).to.equal(0);
        });

        it("3. 通过 Token ID 查询产品详情 (verifyProduct) 应该返回完整的真伪数据", async function () {
            const data = await registry.verifyProduct(tokenId);
            // 修复：将 expectedOwner 移至测试内部定义，此时 customer2 已初始化
            const expectedOwner = customer2.address; 
            
            // 验证静态数据（真伪确认的核心）
            expect(data.tokenId).to.equal(tokenId, "Token ID should match");
            expect(data.serialNumber).to.equal(TEST_SERIAL_NUMBER, "Serial Number should match");
            expect(data.modelDetails).to.equal(TEST_MODEL_DETAILS, "Model details should match");
            expect(data.manufacturerDetails).to.equal(TEST_MFG_DETAILS, "Manufacturer details should match");
            expect(data.registrationTimestamp).to.be.gt(0, "Registration timestamp should be set");
            
            // 验证所有权信息
            expect(data.currentOwner).to.equal(expectedOwner, "Current owner should match final transfer");
            
            // 验证市场信息
            expect(data.currentPrice).to.equal(TEST_PRICE, "Current price should be 100");
            expect(data.isListed).to.be.true; // 铸造时 isListed 设为 true

            // 验证历史记录
            // 历史记录仅包含铸造时的记录，因为后续的 transferFrom 没有触发 recordOwnershipTransfer
            expect(data.ownershipHistory).to.have.lengthOf(1, "History should only have 1 entry from minting.");
            expect(data.ownershipHistory[0].eventType).to.equal("MINT_DISTRIBUTION");
        });
        
        it("4. 查询不存在的 Token ID (verifyProduct) 应该失败", async function () {
            await expect(registry.verifyProduct(9999)).to.be.revertedWith("PR: Product ID does not exist on chain.");
        });
    });
});