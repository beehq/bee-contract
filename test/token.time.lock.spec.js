const assert = require('assert')
const ganache = require('ganache-cli')
const { it } = require('mocha')
const Web3 = require('web3')
const options = { gasLimit: 10000000 };
const web3 = new Web3(ganache.provider(options))
const { TokenTimelock, TestTokenTimeLock } = require('../compile')
const { abi, evm } = TestTokenTimeLock
const timeLockABI = TokenTimelock.abi;
const moment = require('moment');

let accounts;
let contract;
const ONE_SECOND = 1000;
const ONE_MINUTE = 60 * ONE_SECOND;
const ONE_HOUR = 60 * ONE_MINUTE;

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

const convertAmountToken = (token) => Number(token.substring(0, token.length - 18))
const getTimeLockContract = (address) => new web3.eth.Contract(timeLockABI, address);
let timeLockedContract;

before(async () => {
    accounts = await web3.eth.getAccounts()
    console.log(await web3.eth.getBalance(accounts[0]));
    contract = await new web3.eth.Contract(abi)
        .deploy({ data: evm.bytecode.object, arguments: [] })
        .send({ from: accounts[0], gas: "9999999" })
    const timeLockedContractAddress = await contract.methods.timeLockedContractAddress().call()
    timeLockedContract = await getTimeLockContract(timeLockedContractAddress);
})

describe('Time Lock Contract: deployed & correct initial data', async function () {
    it('Deploy contract', () => {
        const address = contract.options.address
        assert.ok(address)
    })

    it('Existed time lock contract', () => {
        assert.ok(timeLockedContract._address)
    })

    it('Check init test: releaseAmount: 2000; releasePeriod: 15s; periodAccelerate: 100 ', async () => {
        const nextReleaseTime = await timeLockedContract.methods.nextReleaseTime().call();
        const releaseAmount = await timeLockedContract.methods.releaseAmount().call();
        const releasePeriod = await timeLockedContract.methods.releasePeriod().call();
        const periodAccelerate = await timeLockedContract.methods.periodAccelerate().call();
        console.log(moment(new Date(Number(nextReleaseTime * 1000))).format('HH:mm:ss DD:MM:yyyy'));
        // console.log({ nextReleaseTime });
        assert.equal(releaseAmount, '2000')
        assert.equal(releasePeriod, '15')
        assert.equal(periodAccelerate, '100')
        assert.ok(timeLockedContract._address)
    })
})


describe('Time Lock Contract: Check release amount by time', async () => {
    // this.timeout(ONE_HOUR);
    let indexUnitTest = 0;
    let period = 15; // 15 second
    beforeEach(async function () {
        const blockTime = Math.round(new Date().getTime() / 1000) + indexUnitTest * period + 1;
        // console.log({blockTime});
        await advanceBlockAtTime(blockTime);
        indexUnitTest++;
    })

    it('Release period: 1', async () => {
        const calcPassedPeriods = await timeLockedContract.methods.calcPassedPeriods().call();
        const payedPeriod = await timeLockedContract.methods.payedPeriod().call();
        const releasableAmount = await timeLockedContract.methods.releasableAmount().call();
        assert.equal(calcPassedPeriods,'1')
        assert.equal(releasableAmount, '2000');
        // console.log({ calcPassedPeriods, payedPeriod, releasableAmount });
    })

    it('Release period: 2', async () => {
        const calcPassedPeriods = await timeLockedContract.methods.calcPassedPeriods().call();
        const payedPeriod = await timeLockedContract.methods.payedPeriod().call();
        const releasableAmount = await timeLockedContract.methods.releasableAmount().call();
        assert.equal(calcPassedPeriods,'2')
        assert.equal(releasableAmount, '4100');
        // console.log({ calcPassedPeriods, payedPeriod, releasableAmount });

    })

    it('Release period: 3', async () => {
        const calcPassedPeriods = await timeLockedContract.methods.calcPassedPeriods().call();
        const payedPeriod = await timeLockedContract.methods.payedPeriod().call();
        const releasableAmount = await timeLockedContract.methods.releasableAmount().call();
        const isRelease = await timeLockedContract.methods.release().call()
        assert.equal(calcPassedPeriods,'3')
        assert.equal(releasableAmount, '6300');
        // console.log({ isRelease, calcPassedPeriods, payedPeriod, releasableAmount });

    })

    it('Release period: 4', async () => {
        const calcPassedPeriods = await timeLockedContract.methods.calcPassedPeriods().call();
        const payedPeriod = await timeLockedContract.methods.payedPeriod().call();
        const releasableAmount = await timeLockedContract.methods.releasableAmount().call();
        assert.equal(calcPassedPeriods,'4')
        assert.equal(releasableAmount, '8600');
        // console.log({ calcPassedPeriods, payedPeriod, releasableAmount });

    })

    it('Release period: 5', async () => {
        const calcPassedPeriods = await timeLockedContract.methods.calcPassedPeriods().call();
        const payedPeriod = await timeLockedContract.methods.payedPeriod().call();
        const releasableAmount = await timeLockedContract.methods.releasableAmount().call();
        assert.equal(calcPassedPeriods,'5')
        assert.equal(releasableAmount, '11000');
        // console.log({ calcPassedPeriods, payedPeriod, releasableAmount });
    })
})