import { redirect } from "next/navigation";

// /admin is the Control Room. Old links (and the retired :3001 console) land here.
export default function AdminIndex() {
  redirect("/admin/control");
}
