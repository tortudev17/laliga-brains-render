import { useEffect, useState } from "react";
import { CircleUserRound } from "lucide-react";
import { getDownloadURL, ref as storageRef } from "firebase/storage";
import { getFirebaseStorage } from "../services/firebase/client";

type UserAvatarProps = {
  photoPath?: string | null;
  name: string;
  size?: number;
  className?: string;
};

export function UserAvatar({ photoPath, name, size = 38, className = "" }: UserAvatarProps) {
  const [url, setUrl] = useState("");

  useEffect(() => {
    let active = true;
    setUrl("");
    if (!photoPath) return () => { active = false; };

    void getFirebaseStorage()
      .then((storage) => getDownloadURL(storageRef(storage, photoPath)))
      .then((nextUrl) => { if (active) setUrl(nextUrl); })
      .catch(() => { if (active) setUrl(""); });

    return () => { active = false; };
  }, [photoPath]);

  return <span className={`user-avatar ${className}`} style={{ width: size, height: size }} aria-label={`Foto de ${name}`}>
    {url ? <img src={url} alt="" onError={() => setUrl("")} /> : <CircleUserRound size={Math.round(size * 0.58)} aria-hidden="true" />}
  </span>;
}
