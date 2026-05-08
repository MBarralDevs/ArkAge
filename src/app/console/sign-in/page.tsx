import {
    Card,
    CardContent,
    CardHeader,
    CardTitle,
} from "@/components/ui/card";
import { PasskeySignIn } from "@/components/auth/passkey-sign-in";

export const dynamic = "force-dynamic";

export default function SignInPage() {
    return (
        <div className="mx-auto flex w-full max-w-md flex-1 items-center px-4 py-16">
            <Card className="w-full">
                <CardHeader>
                    <CardTitle className="text-xl">Builder console</CardTitle>
                    <p className="text-sm text-muted-foreground">
                        Non-custodial sign-in. We never see your passkey.
                    </p>
                </CardHeader>
                <CardContent>
                    <PasskeySignIn />
                </CardContent>
            </Card>
        </div>
    );
}
