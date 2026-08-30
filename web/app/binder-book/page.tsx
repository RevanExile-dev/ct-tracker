import { redirect } from "next/navigation";

export default function LegacyBinderBookPage() {
  redirect("/binder?view=book");
}
