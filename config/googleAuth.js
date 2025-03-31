import passport from "passport";
import { Strategy as GoogleStrategy } from "passport-google-oauth20";
import User from "../models/User.js"; // Make sure path is correct
import dotenv from "dotenv";

dotenv.config();

export const googleAuthConfig = {
  clientID: process.env.GOOGLE_CLIENT_ID,
  clientSecret: process.env.GOOGLE_CLIENT_SECRET,
  // Fix: Use BACKEND_URL instead of FRONTEND_URL for the callback
  callbackURL: `${process.env.BACKEND_URL}/auth/google/callback`,
};

passport.use(
  new GoogleStrategy(
    googleAuthConfig,
    async (accessToken, refreshToken, profile, done) => {
      try {
        let user = await User.findOne({ googleId: profile.id });

        if (!user) {
          user = new User({
            googleId: profile.id,
            email: profile.emails[0].value,
            name: profile.displayName,
            profilePic: profile.photos[0].value,
          });
          await user.save();
        }

        done(null, user);
      } catch (error) {
        console.error("Error in Google OAuth Strategy:", error);
        done(error, null);
      }
    }
  )
);

passport.serializeUser((user, done) => {
  done(null, user.id);
});

passport.deserializeUser(async (id, done) => {
  try {
    const user = await User.findById(id);
    done(null, user);
  } catch (error) {
    done(error, null);
  }
});

export default passport;
