const assert = require('assert')
const ganache = require('ganache-cli')
const { it } = require('mocha')
const Web3 = require('web3')
const options = { gasLimit: 20000000 };
const web3 = new Web3(ganache.provider(options))
const { Bee, TokenTimelock } = require('../compile')
const { abi, evm } = Bee

const ONE_SECOND = 1000;
const ONE_MINUTE = 60 * ONE_SECOND;
const ONE_HOUR = 60 * ONE_MINUTE;
const ONE_DAY = 24 * ONE_HOUR;
const timeLockABI = TokenTimelock.abi;

// Bee Token released at 31/01/2022
let startTime = new Date(1643587200 * 1000);

let accounts;
let contract;
let holders;
let timeLockedContractAddresses;

const convertAmountToken = (token) => Number(token.substring(0, token.length - 18))
const getTimeLockContract = (address) => new web3.eth.Contract(timeLockABI, address);
const advanceBlockAtTime = (time) => {
    return new Promise((resolve, reject) => {
        web3.currentProvider.send(
            {
                jsonrpc: "2.0",
                method: "evm_mine",
                params: [time],
                id: new Date().getTime(),
            },
            (err, _) => {
                if (err) {
                    return reject(err);
                }
                const newBlockHash = web3.eth.getBlock("latest").hash;

                return resolve(newBlockHash);
            },
        );
    });
};

const totalSupply = 1000000000;

before(async () => {
    accounts = await web3.eth.getAccounts()
    // console.log(await web3.eth.getBalance(accounts[0]));
    contract = await new web3.eth.Contract(abi)
        .deploy({ data: evm.bytecode.object, arguments: [] })
        .send({ from: accounts[0], gas: "20000000" })

    holders = await contract.methods.getHolders().call()
    holders = holders.map(holder => ({
        name: holder.name,
        holderAddress: holder.holderAddress,
        pool: convertAmountToken(holder.pool),
        vestingStartAfter: Number(holder.vestingStartAfter),
        vestingInitPercent: Number(holder.vestingInitPercent),
        vestingLockTime: Number(holder.vestingLockTime),
        vestingPeriod: Number(holder.vestingPeriod),
        vestingPeriodStepper: Number(holder.vestingPeriodStepper),
        vestingTime: Number(holder.vestingTime)
    }))

    timeLockedContractAddresses = await contract.methods.getTimeLockedContractAddresses().call();
    timeLockedContractAddresses = timeLockedContractAddresses.map(t => ({
        holderName: t.holderName,
        desc: t.desc,
        amount: t.amount,
        contractAddress: t.contractAddress
    }))

    holders = holders.map(h => ({ ...h, timeLockedContractAddresses: timeLockedContractAddresses.filter(t => t.holderName == h.name) }))
})

describe('Test BEE contract', async () => {

    it('Deployed contract', () => {
        const address = contract.options.address
        console.log({ address });
        assert.ok(address)
    })

    it('Total supply is 1.000.000.000 tokens', async () => {
        const contractTotalSupply = convertAmountToken(await contract.methods.totalSupply().call());
        assert.equal(contractTotalSupply, totalSupply) // equal 1.000.000.000 * 10^18
    })

    it('Total tokens distributed for all holders is 1.000.000.000 tokens', async () => {
        assert.equal(holders.map(holder => holder.pool).reduce((sum, pool) => sum += pool, 0), totalSupply) // equal 1.000.000.000 * 10^18
    })

    // Total token for each holder = Token already distribute + Token locked from contracts
    it('Total tokens distributed for each holder is correct!', async () => {
        const everyHoldersDistributedCorrect = await holders.every(async holder => {
            const tokenDistributed = convertAmountToken(await contract.methods.balanceOf(holder.holderAddress).call())
            const totalTokenLocked = (await Promise.all(holder.timeLockedContractAddresses.map(async lockedAddress => {
                const tokenLocked = convertAmountToken(await contract.methods.balanceOf(lockedAddress.contractAddress).call())
                return tokenLocked;
            }))).reduce((sum, tokenLocked) => sum += tokenLocked, 0)
            // console.log(holder.name, {pool: holder.pool, tokenDistributed, totalTokenLocked });
            return holder.pool == tokenDistributed + totalTokenLocked;
        })
        assert.equal(everyHoldersDistributedCorrect, true)
    })

    it('PRIVATE SALE: 15% vesting right after lockup time on sale plan, 6 months lockup, monthly linear vesting in next 24 months.', async () => {
        const privateSale = holders.find(h => h.name == 'Private sale');
        const tokenPrivateSale = totalSupply * 5 / 100;
        const initAmount = tokenPrivateSale * 15 / 100;

        // Total for private sale is 5%
        assert.equal(privateSale.pool, tokenPrivateSale);

        // Distributed 15% when contract deployed
        const tokenDistributed = convertAmountToken(await contract.methods.balanceOf(privateSale.holderAddress).call())
        assert.equal(tokenDistributed, initAmount)

        // Lock: 6 months = 180 days
        const timeLockedContract = getTimeLockContract(privateSale.timeLockedContractAddresses[0].contractAddress);
        const nextReleaseTime = await timeLockedContract.methods.nextReleaseTime().call();
        const expectedReleaseTime = new Date(startTime.getTime() + 6 * 30 * ONE_DAY) / ONE_SECOND;
        const releaseTime = Number(nextReleaseTime);
        assert.ok(Math.abs(expectedReleaseTime - releaseTime) < ONE_MINUTE);

        // Vesting plan: release amount & release period
        const releaseAmount = convertAmountToken(await timeLockedContract.methods.releaseAmount().call());
        const releasePeriod = await timeLockedContract.methods.releasePeriod().call();
        assert.ok((Math.abs(tokenPrivateSale - initAmount) / 24 - releaseAmount) < 1); // release 24 months of 85%
        assert.equal(Number(releasePeriod), (30 * ONE_DAY) / ONE_SECOND);
    })

    it('PRE SALE: start: 01/05/2022; 30% vesting right after lockup time on sale plan, 3 months lockup, monthly linear vesting in next 12 months.',
        async () => {
            const preSale = holders.find(h => h.name == 'Pre sale');
            const tokenPreSale = totalSupply * 2 / 100;
            const initAmount = tokenPreSale * 30 / 100;

            // Total for private sale is 2%
            assert.equal(preSale.pool, tokenPreSale);

            // Lock: Start sale in next 90 days. 30% will be release , 70% will be locked in next 90 days & will release by vesting plan 
            await Promise.all(preSale.timeLockedContractAddresses.map(async (t, index) => {
                const timeLockedContract = getTimeLockContract(t.contractAddress);
                const nextReleaseTime = await timeLockedContract.methods.nextReleaseTime().call();
                const lockedDays = index == 0 ? 90 : 90 + 90;
                const calcReleaseTime = new Date(startTime.getTime() + lockedDays * ONE_DAY) / ONE_SECOND;
                assert.ok(Math.abs(calcReleaseTime - Number(nextReleaseTime)) < ONE_MINUTE);
            }))

            // Vesting plan: release amount & release period
            const timeLockedContract = getTimeLockContract(preSale.timeLockedContractAddresses[1].contractAddress);
            const releaseAmount = convertAmountToken(await timeLockedContract.methods.releaseAmount().call());
            const releasePeriod = await timeLockedContract.methods.releasePeriod().call();
            assert.ok(Math.abs((tokenPreSale - initAmount) / 12 - releaseAmount) < 1); // release 12 months of 85%
            assert.equal(Number(releasePeriod), (30 * ONE_DAY) / ONE_SECOND);
        })

    it('IDO: start: 31/05/2022; 100% vesting after sale plan.', async () => {
        const idoSale = holders.find(h => h.name == 'IDO');
        const tokenIDOSale = totalSupply * 1 / 100;

        // Lock until 31/05/2022 => 120 days
        const timeLockedContract = getTimeLockContract(idoSale.timeLockedContractAddresses[0].contractAddress);
        const nextReleaseTime = await timeLockedContract.methods.nextReleaseTime().call();
        assert.ok(Math.abs(new Date(startTime.getTime() + 120 * ONE_DAY) / ONE_SECOND - Number(nextReleaseTime)) < ONE_MINUTE);

        // Vesting plan: 100% after 120 days
        const releaseAmount = convertAmountToken(await timeLockedContract.methods.releaseAmount().call());
        assert.ok(Math.abs(tokenIDOSale - releaseAmount) < 1); // release 30 month of 85%
    })

    it('Marketing: start: 31/01/2022; 20% tokens, Monthly linear vesting in remaining time (total vesting 4 years).', async () => {
        const marketingLockedContract = holders.find(h => h.name == 'Marketing');
        const tokenMarketing = totalSupply * 20 / 100;
        const timeLockedContract = getTimeLockContract(marketingLockedContract.timeLockedContractAddresses[0].contractAddress);

        // Vesting plan: monthly with in 4 years => 48 months
        const releaseAmount = convertAmountToken(await timeLockedContract.methods.releaseAmount().call());
        const releasePeriod = await timeLockedContract.methods.releasePeriod().call();
        // amount vesting monthly
        assert.ok(Math.abs((tokenMarketing / 48) - releaseAmount) < 1);
        assert.equal(Number(releasePeriod), (30 * ONE_DAY) / ONE_SECOND);
    })

    it('Team: 12-month cliff, linear vesting for 36 months (total vesting 4 years)', async () => {
        const teamLockedContract = holders.find(h => h.name == 'Team');
        const tokenTeam = totalSupply * 15 / 100;
        const timeLockedContract = getTimeLockContract(teamLockedContract.timeLockedContractAddresses[0].contractAddress);

        // Lock until 31/01/2023 => 365 days
        const nextReleaseTime = await timeLockedContract.methods.nextReleaseTime().call();
        assert.ok(Math.abs(new Date(startTime.getTime() + 365 * ONE_DAY) / ONE_SECOND - Number(nextReleaseTime)) < ONE_MINUTE);

        // Vesting plan: monthly with in 3 years => 36 months
        const releaseAmount = convertAmountToken(await timeLockedContract.methods.releaseAmount().call());
        const releasePeriod = await timeLockedContract.methods.releasePeriod().call();
        assert.ok(Math.abs((tokenTeam / 36) - releaseAmount) < 1);
        assert.equal(Number(releasePeriod), (30 * ONE_DAY) / ONE_SECOND);
    })

    it('Advisor: 12-month cliff, linear vesting for 36 months (total vesting 4 years)', async () => {
        const advisorLockedContract = holders.find(h => h.name == 'Advisor');
        const tokenAdvisor = totalSupply * 5 / 100;
        const timeLockedContract = getTimeLockContract(advisorLockedContract.timeLockedContractAddresses[0].contractAddress);

        // Lock until 31/01/2023 => 365 days
        const nextReleaseTime = await timeLockedContract.methods.nextReleaseTime().call();
        assert.ok(Math.abs(new Date(startTime.getTime() + 365 * ONE_DAY) / ONE_SECOND - Number(nextReleaseTime)) < ONE_MINUTE);

        // Vesting plan: monthly with in 3 years => 36 months
        const releaseAmount = convertAmountToken(await timeLockedContract.methods.releaseAmount().call());
        const releasePeriod = await timeLockedContract.methods.releasePeriod().call();
        assert.ok(Math.abs((tokenAdvisor / 36) - releaseAmount) < 1);
        assert.equal(Number(releasePeriod), (30 * ONE_DAY) / ONE_SECOND);
    })

    it('Reserve fund: Monthly linear vesting in remaining time (total 4 years)', async () => {
        const reserveFundLockedContract = holders.find(h => h.name == 'Reserve fund');
        const tokenReserveFund = totalSupply * 15 / 100;
        const timeLockedContract = getTimeLockContract(reserveFundLockedContract.timeLockedContractAddresses[0].contractAddress);

        // Vesting plan: monthly with in 4 years => 48 months
        const releaseAmount = convertAmountToken(await timeLockedContract.methods.releaseAmount().call());
        const releasePeriod = await timeLockedContract.methods.releasePeriod().call();
        // amount vesting monthly
        assert.ok(Math.abs((tokenReserveFund / 48) - releaseAmount) < 1);
        assert.equal(Number(releasePeriod), (30 * ONE_DAY) / ONE_SECOND);
    })

    it('Liquidity: 7%: Start release 01/06/2022. Each month will be release 10%', async () => {
        const liquidityLockedContract = holders.find(h => h.name == 'Liquidity');
        const tokenLiquidity = totalSupply * 7 / 100;

        const timeLockedContract = getTimeLockContract(liquidityLockedContract.timeLockedContractAddresses[0].contractAddress);

        // Lock until 01/06/2022 => 120 days
        const nextReleaseTime = await timeLockedContract.methods.nextReleaseTime().call();
        assert.ok(Math.abs(new Date(startTime.getTime() + 120 * ONE_DAY) / ONE_SECOND - Number(nextReleaseTime)) < ONE_MINUTE);

        // Vesting plan: will be release 10% for each 60 days
        const releaseAmount = convertAmountToken(await timeLockedContract.methods.releaseAmount().call());
        const releasePeriod = await timeLockedContract.methods.releasePeriod().call();

        // amount vesting monthly
        assert.ok(Math.abs((tokenLiquidity / 10) - releaseAmount) < 1);
        assert.equal(Number(releasePeriod), (60 * ONE_DAY) / ONE_SECOND);
    })
})

describe('Test Reward & Stacking release plan', async () => {
    let indexUnitTest = 0;
    let period = 30 * ONE_DAY;
    console.log({ startTime });
    let timeLockedContract;
    beforeEach(async function () {
        const contracts = holders.find(h => h.name == 'Reward & Stacking');
        timeLockedContract = getTimeLockContract(contracts.timeLockedContractAddresses[0].contractAddress);
        const blockTime = Math.round(startTime.getTime() / 1000) + indexUnitTest * period / 1000 + 1;
        await advanceBlockAtTime(blockTime);
        indexUnitTest++;
    })

    it('Release month 1', async () => {
        const calcPassedPeriods = await timeLockedContract.methods.calcPassedPeriods().call();
        const releasableAmount = convertAmountToken(await timeLockedContract.methods.releasableAmount().call());
        assert.equal(releasableAmount, 1010000);
    })

    it('Release month 2', async () => {
        const releasableAmount = convertAmountToken(await timeLockedContract.methods.releasableAmount().call());
        const calcPassedPeriods = await timeLockedContract.methods.calcPassedPeriods().call();
        assert.equal(releasableAmount, 2110000);

    })

    it('Release month 3', async () => {
        const releasableAmount = convertAmountToken(await timeLockedContract.methods.releasableAmount().call());
        assert.equal(releasableAmount, 3300000);

    })

    it('Release month 4', async () => {
        const releasableAmount = convertAmountToken(await timeLockedContract.methods.releasableAmount().call());
        assert.equal(releasableAmount, 4580000);

    })

    it('Release month 5', async () => {
        const releasableAmount = convertAmountToken(await timeLockedContract.methods.releasableAmount().call());
        assert.equal(releasableAmount, 5950000);
    })

    it('Release month 47', async () => {
        const blockTime = Math.round(startTime.getTime() / 1000) + 46 * period / 1000 + 1;
        await advanceBlockAtTime(blockTime);
        const releasableAmount = convertAmountToken(await timeLockedContract.methods.releasableAmount().call());
        assert.equal(releasableAmount, 144760000);
    })

    it('Release month 48', async () => {
        const blockTime = Math.round(startTime.getTime() / 1000) + 47 * period / 1000 + 1;
        await advanceBlockAtTime(blockTime);
        const releasableAmount = convertAmountToken(await timeLockedContract.methods.releasableAmount().call());
        assert.equal(releasableAmount, 150000000);
    })
})


describe('Test liquidity release plan', async () => {
    let indexUnitTest = 0;
    let period = 60 * ONE_DAY;
    let liquidityContractStartTime = new Date(startTime.getTime() + 120 * ONE_DAY);
    let timeLockedContract;
    console.log({ liquidityContractStartTime });

    beforeEach(async function () {
        const contracts = holders.find(h => h.name == 'Liquidity');
        timeLockedContract = getTimeLockContract(contracts.timeLockedContractAddresses[0].contractAddress);
        const blockTime = Math.round(liquidityContractStartTime.getTime() / 1000) + indexUnitTest * period / 1000 + 1;
        console.log("blockTime", new Date(blockTime * ONE_SECOND));
        await advanceBlockAtTime(blockTime);
        indexUnitTest++;
    })

    it('Total release 01/06/2022 => amount = 7.000.000 tokens', async () => {
        // const calcPassedPeriods = await timeLockedContract.methods.calcPassedPeriods().call();
        const releasableAmount = convertAmountToken(await timeLockedContract.methods.releasableAmount().call());
        assert.equal(releasableAmount, 7000000);
    })

    it('Total release 01/08/2022 => amount = 14.000.000 tokens', async () => {
        // const calcPassedPeriods = await timeLockedContract.methods.calcPassedPeriods().call();
        const releasableAmount = convertAmountToken(await timeLockedContract.methods.releasableAmount().call());
        assert.equal(releasableAmount, 14000000);
    })
})