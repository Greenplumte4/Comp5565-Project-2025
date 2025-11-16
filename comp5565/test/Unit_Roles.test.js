// File: test/Unit_Roles.test.js

const { expect } = require("chai");
const { ethers } = require("hardhat");

// Unit Test: RolesContract：专注于测试角色合约的权限控制和角色查询功能。
describe("Unit Test: RolesContract", function () {
    let rolesContract;
    let deployer, admin2, manufacturer, retailer, serviceCenter, user;

    // 预设角色哈希
    const DEFAULT_ADMIN_ROLE = '0x0000000000000000000000000000000000000000000000000000000000000000';
    const MANUFACTURER_ROLE = ethers.id("MANUFACTURER_ROLE");
    const RETAILER_ROLE = ethers.id("RETAILER_ROLE");
    const SERVICECENTER_ROLE = ethers.id("SERVICECENTER_ROLE");

    // before：在所有测试开始前，部署合约并获取测试账户。
    before(async function () {
        // 获取测试账户
        [deployer, admin2, manufacturer, retailer, serviceCenter, user] = await ethers.getSigners();

        // 部署 RolesContract。部署者自动获得 DEFAULT_ADMIN_ROLE
        const RolesContract = await ethers.getContractFactory("RolesContract");
        rolesContract = await RolesContract.deploy();
    });

    // 部署与初始化：验证合约部署后的初始状态。
    describe("部署与初始化", function () {
        // 验证部署者是否获得了管理员角色。
        it("部署者应拥有 DEFAULT_ADMIN_ROLE", async function () {
            expect(await rolesContract.hasRole(DEFAULT_ADMIN_ROLE, deployer.address)).to.be.true;
        });

        // 验证合约内定义的角色哈希是否与本地计算的哈希一致。
        it("应正确定义角色常量", async function () {
            expect(await rolesContract.MANUFACTURER_ROLE()).to.equal(MANUFACTURER_ROLE);
            expect(await rolesContract.RETAILER_ROLE()).to.equal(RETAILER_ROLE);
            expect(await rolesContract.SERVICECENTER_ROLE()).to.equal(SERVICECENTER_ROLE);
        });
    });

    // 角色授予 (Granting Roles)：测试只有管理员才能授予角色的权限控制。
    describe("角色授予 (Granting Roles)", function () {
        // 成功测试：管理员授予所有业务角色。
        it("管理员应能成功授予角色", async function () {
            // Deployer 授予 Manufacturer 角色
            await expect(rolesContract.connect(deployer).grantRole(MANUFACTURER_ROLE, manufacturer.address))
                .to.not.be.reverted;
            
            // 授予 Retailer 角色
            await rolesContract.connect(deployer).grantRole(RETAILER_ROLE, retailer.address);

            // 授予 ServiceCenter 角色
            await rolesContract.connect(deployer).grantRole(SERVICECENTER_ROLE, serviceCenter.address);
        });

        // 负面测试：非管理员尝试授予角色应失败。
        it("非管理员尝试授予角色应失败 (Revert)", async function () {
            // User 尝试授予角色，应抛出 AccessControlUnauthorizedAccount 错误
            await expect(rolesContract.connect(user).grantRole(MANUFACTURER_ROLE, user.address))
                .to.be.revertedWithCustomError(rolesContract, "AccessControlUnauthorizedAccount");
        });
    });

    // 角色验证 (Role Verification)：测试业务角色查询函数。
    describe("角色验证 (Role Verification)", function () {
        // 验证 isManufacturer() 查询结果是否正确。
        it("isManufacturer() 应返回正确状态", async function () {
            expect(await rolesContract.isManufacturer(manufacturer.address)).to.be.true;
            expect(await rolesContract.isManufacturer(user.address)).to.be.false;
        });

        // 验证 isRetailer() 查询结果是否正确。
        it("isRetailer() 应返回正确状态", async function () {
            expect(await rolesContract.isRetailer(retailer.address)).to.be.true;
            expect(await rolesContract.isRetailer(user.address)).to.be.false;
        });

        // 验证 isServiceCenter() 查询结果是否正确。
        it("isServiceCenter() 应返回正确状态", async function () {
            expect(await rolesContract.isServiceCenter(serviceCenter.address)).to.be.true;
            expect(await rolesContract.isServiceCenter(user.address)).to.be.false;
        });

        // 验证 hasAnyRole() 是否能正确检查任一业务角色。
        it("hasAnyRole() 应返回正确状态", async function () {
            // Manufacturer 和 Retailer 拥有角色
            expect(await rolesContract.hasAnyRole(manufacturer.address)).to.be.true;
            expect(await rolesContract.hasAnyRole(retailer.address)).to.be.true;
            // User 不拥有任何业务角色
            expect(await rolesContract.hasAnyRole(user.address)).to.be.false;
        });
    });

    // 角色撤销 (Revoking Roles)：测试只有管理员才能撤销角色的权限控制。
    describe("角色撤销 (Revoking Roles)", function () {
        // 成功测试：管理员撤销 Manufacturer 角色。
        it("管理员应能成功撤销角色", async function () {
            // 撤销 Manufacturer 角色
            await expect(rolesContract.connect(deployer).revokeRole(MANUFACTURER_ROLE, manufacturer.address))
                .to.not.be.reverted;
            
            // 验证角色已撤销
            expect(await rolesContract.isManufacturer(manufacturer.address)).to.be.false;
        });

        // 负面测试：非管理员尝试撤销角色应失败。
        it("非管理员尝试撤销角色应失败 (Revert)", async function () {
            // User 尝试撤销 Retailer 角色
            await expect(rolesContract.connect(user).revokeRole(RETAILER_ROLE, retailer.address))
                .to.be.revertedWithCustomError(rolesContract, "AccessControlUnauthorizedAccount");
            
            // 验证 Retailer 角色未被撤销 (确保拒绝有效)
            expect(await rolesContract.isRetailer(retailer.address)).to.be.true;
        });
    });
});