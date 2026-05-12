import { requireBuilder } from "@/lib/auth-guard";
import {
    Card,
    CardContent,
    CardHeader,
    CardTitle,
    CardDescription,
} from "@/components/ui/card";
import { ConnectCircleAgentWalletForm } from "@/components/console/connect-circle-agent-wallet-form";
import { CopyableCommand } from "@/components/console/copyable-command";
import { Separator } from "@/components/ui/separator";

export const dynamic = "force-dynamic";

export default async function ConsoleNewAgentPage() {
    await requireBuilder();

    return (
        <div className="mx-auto max-w-3xl space-y-6">
            <div>
                <h1 className="text-2xl font-semibold tracking-tight">
                    Register a new agent
                </h1>
                <p className="mt-1 text-sm text-muted-foreground">
                    Connect a Circle Agent Wallet you provisioned via the
                    Circle CLI. ArkAge never holds your wallet session — the
                    CLI lives on your machine, and your agent runtime drives
                    it directly.
                </p>
            </div>

            <Card>
                <CardHeader>
                    <CardTitle className="text-base">
                        1. Provision a Circle Agent Wallet locally
                    </CardTitle>
                    <CardDescription>
                        Run these commands on the machine where your agent
                        will run. The session lasts 7 days and is bound to
                        your email.
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                    <CopyableCommand
                        label="Install the CLI (Node 20.18.2+ required)"
                        command="npm install -g @circle-fin/cli"
                    />
                    <CopyableCommand
                        label="Log in (testnet — separate session from mainnet)"
                        command={`CIRCLE_ACCEPT_TERMS=1 circle wallet login your@email.com --type agent --testnet --init --output json`}
                    />
                    <p className="text-xs text-muted-foreground">
                        Then complete the login with the OTP that lands in
                        your inbox:
                    </p>
                    <CopyableCommand
                        label=""
                        command={`CIRCLE_ACCEPT_TERMS=1 circle wallet login --request <REQUEST_ID> --otp <CODE> --output json`}
                    />
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle className="text-base">
                        2. Read your wallet details
                    </CardTitle>
                    <CardDescription>
                        You need three values: the SCA address, the controlling
                        email, and the backing EOA address.
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                    <CopyableCommand
                        label="List your auto-provisioned SCA on Arc Testnet"
                        command={`CIRCLE_ACCEPT_TERMS=1 circle wallet list --type agent --chain ARC-TESTNET --output json`}
                    />
                    <CopyableCommand
                        label="Find the backing EOA (in the JSON's backingEOA field)"
                        command={`CIRCLE_ACCEPT_TERMS=1 circle gateway balance --address 0xYOUR_SCA --chain ARC-TESTNET --output json`}
                    />
                    <CopyableCommand
                        label="Fund the testnet wallet (20 USDC drip)"
                        command={`CIRCLE_ACCEPT_TERMS=1 circle wallet fund --address 0xYOUR_SCA --chain ARC-TESTNET --token usdc --output json`}
                    />
                </CardContent>
            </Card>

            <Separator />

            <Card>
                <CardHeader>
                    <CardTitle className="text-base">
                        3. Register the wallet with ArkAge
                    </CardTitle>
                    <CardDescription>
                        Paste the values from above. ArkAge stores them and
                        wires up a permissive default policy so you can start
                        using the agent immediately.
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <ConnectCircleAgentWalletForm />
                </CardContent>
            </Card>
        </div>
    );
}
